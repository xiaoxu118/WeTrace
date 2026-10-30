import type { ReportParticipant } from '../shared/report-facts'
import type { ChatIndexSearchMatch, ChatIndexAction, ChatIndexStatus } from '../shared/chat-index'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { cacheImagePreview, readImagePreview } from './image-preview-cache'
import type { RecordsCommand, RecordsEvent, PreviewData } from '../shared/records-process'
import type { SyncConversation, ConversationIndexQuery, ConversationIndexSummary, SpeechStatsQuery, SpeechStatsResult, SyncMessage, ReportMessagesFilter, ReportMessagesResult, SyncResult, WechatAccount } from '../shared/types'

type RecordsLane = 'records' | 'statistics' | 'indexing'
const processInstances = new Map<RecordsLane, UtilityProcess>()
let nextId = 0
const pending = new Map<number, { child: UtilityProcess; resolve: (result: unknown) => void; reject: (error: Error) => void }>()
const syncing = new Map<string, Promise<SyncResult>>()
const validating = new Map<string, Promise<void>>()
const validKeys = new Set<string>()
const identity = (root: string, key: string): string => createHash('sha256').update(root).update('\0').update(key).digest('hex')

function recordsProcess(lane: RecordsLane): UtilityProcess {
  const existing = processInstances.get(lane)
  if (existing) return existing
  const child = utilityProcess.fork(join(__dirname, 'wechat-records-process.js'), [], { serviceName: lane === 'indexing' ? 'WeTrace 聊天索引' : lane === 'statistics' ? 'WeTrace 发言统计' : 'WeTrace 聊天读取' })
  processInstances.set(lane, child)
  child.on('message', (event: RecordsEvent) => {
    if (event.type === 'preview') { cacheImagePreview(Buffer.from(event.preview.data), event.preview.mime); return }
    const task = pending.get(event.id)
    if (!task || task.child !== child) return
    pending.delete(event.id)
    if (event.error) task.reject(new Error(event.error))
    else task.resolve(event.result)
  })
  child.on('exit', () => {
    if (processInstances.get(lane) !== child) return
    processInstances.delete(lane)
    if (lane === 'records') validKeys.clear()
    for (const [id, task] of pending) {
      if (task.child !== child) continue
      task.reject(new Error('聊天读取进程已退出，请重新加载记录'))
      pending.delete(id)
    }
  })
  child.postMessage({ type: 'init', paths: { appPath: app.getAppPath(), resourcesPath: process.resourcesPath, statsPath: join(app.getPath('userData'), 'speech-index') } } satisfies RecordsCommand)
  return child
}

function request<T>(command: Exclude<RecordsCommand, { type: 'init' }> extends infer Command ? Command extends { id: number } ? Omit<Command, 'id'> : never : never): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = recordsProcess(command.type === 'chat-index' ? 'indexing' : command.type === 'index-search' || command.type === 'index-conversation' || command.type === 'speech' || command.type === 'conversation-summary' ? 'statistics' : 'records')
    const id = ++nextId
    pending.set(id, { child, resolve: result => resolve(result as T), reject })
    try { child.postMessage({ ...command, id }) } catch (error) { pending.delete(id); reject(error) }
  })
}

export function runWechatSync(account: WechatAccount, key: string): Promise<SyncResult> {
  const id = identity(account.root, key)
  const existing = syncing.get(id)
  if (existing) return existing
  const promise = request<SyncResult>({ type: 'sync', account, key }).finally(() => syncing.delete(id))
  syncing.set(id, promise)
  return promise
}

export function runWechatReportQuery(
  account: WechatAccount,
  key: string,
  query: ReportMessagesFilter
): Promise<ReportMessagesResult> {
  return request<ReportMessagesResult>({ type: 'report', account, key, query })
}

export function validateWechatDatabase(root: string, key: string): Promise<void> {
  const id = identity(root, key)
  if (validKeys.has(id)) return Promise.resolve()
  const existing = validating.get(id)
  if (existing) return existing
  const promise = request<void>({ type: 'validate', root, key }).then(() => { validKeys.add(id) }).finally(() => validating.delete(id))
  validating.set(id, promise)
  return promise
}

export async function loadImagePreview(id: string): Promise<ReturnType<typeof readImagePreview>> {
  const cached = readImagePreview(id)
  if (cached) return cached
  if (!processInstances.has('records')) return undefined
  const preview = await request<PreviewData | null>({ type: 'image', imageId: id })
  if (!preview) return undefined
  cacheImagePreview(Buffer.from(preview.data), preview.mime)
  return readImagePreview(id)
}

export function stopRecordsProcess(): void { for (const child of processInstances.values()) child.kill() }

export function runWechatSpeechQuery(account: WechatAccount, key: string, query: SpeechStatsQuery): Promise<SpeechStatsResult> {
  return request<SpeechStatsResult>({ type: 'speech', account, key, query })
}

export function runWechatConversationSummary(account: WechatAccount, key: string, query: ConversationIndexQuery): Promise<ConversationIndexSummary> {
  return request<ConversationIndexSummary>({ type: 'conversation-summary', account, key, query })
}

export function runWechatReportMedia(account: WechatAccount, key: string, conversationId: string, message: SyncMessage): Promise<SyncMessage> {
  return request<SyncMessage>({ type: 'report-media', account, key, conversationId, message })
}

export function runWechatChatIndex(account: WechatAccount, key: string, action: ChatIndexAction): Promise<ChatIndexStatus> {
  return request<ChatIndexStatus>({ type: 'chat-index', account, key, action })
}

export function runIndexSearch(account: WechatAccount, key: string, keyword: string): Promise<ChatIndexSearchMatch[]> {
  return request<ChatIndexSearchMatch[]>({ type: 'index-search', account, key, keyword })
}
export function runIndexedConversation(account: WechatAccount, key: string, conversationId: string, at?: number, limit?: number, refresh?: boolean): Promise<SyncConversation> {
  return request<SyncConversation>({ type: 'index-conversation', account, key, conversationId, at, limit, refresh })
}

export function runReportParticipantProfiles(account: WechatAccount, key: string, participants: ReportParticipant[]): Promise<ReportParticipant[]> {
  return request<ReportParticipant[]>({ type: 'report-participants', account, key, participants })
}
