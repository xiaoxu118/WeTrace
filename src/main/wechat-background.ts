import { registerRecallMediaAccount } from './recall-media-store'
import type { ReportParticipant } from '../shared/report-facts'
import type { ChatIndexSearchMatch, ChatIndexAction, ChatIndexStatus } from '../shared/chat-index'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { cacheImagePreview, readImagePreview } from './image-preview-cache'
import { excludedConversations, saveExcludedConversations } from './conversation-cache-policy'
import type { RecordsCommand, RecordsEvent, PreviewData } from '../shared/records-process'
import type { SyncConversation, ConversationIndexQuery, ConversationIndexSummary, SpeechStatsQuery, SpeechStatsResult, SyncMessage, ReportMessagesFilter, ReportMessagesResult, SyncResult, WechatAccount } from '../shared/types'

type RecordsLane = 'records' | 'statistics' | 'indexing' | 'reports'
const processInstances = new Map<RecordsLane, UtilityProcess>()
let nextId = 0
const pending = new Map<number, { child: UtilityProcess; resolve: (result: unknown) => void; reject: (error: Error) => void }>()
const syncing = new Map<string, Promise<SyncResult>>()
const validating = new Map<string, Promise<void>>()
const validKeys = new Set<string>()
const indexStatuses = new Map<string, ChatIndexStatus>()
const identity = (root: string, key: string): string => createHash('sha256').update(root).update('\0').update(key).digest('hex')

function recordsProcess(lane: RecordsLane): UtilityProcess {
  const existing = processInstances.get(lane)
  if (existing) return existing
  const child = utilityProcess.fork(join(__dirname, 'wechat-records-process.js'), [], { serviceName: lane === 'indexing' ? 'WeTrace 聊天索引' : lane === 'reports' ? 'WeTrace 报告读取' : lane === 'statistics' ? 'WeTrace 发言统计' : 'WeTrace 聊天读取' })
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
    if (processInstances.get(lane) === child) {
      processInstances.delete(lane)
      if (lane === 'records') validKeys.clear()
    }
    for (const [id, task] of pending) {
      if (task.child !== child) continue
      task.reject(new Error('聊天读取进程已退出，请重新加载记录'))
      pending.delete(id)
    }
  })
  child.postMessage({ type: 'init', paths: { appPath: app.getAppPath(), resourcesPath: process.resourcesPath, statsPath: join(app.getPath('userData'), 'speech-index') } } satisfies RecordsCommand)
  return child
}

function request<T>(command: Exclude<RecordsCommand, { type: 'init' }> extends infer Command ? Command extends { id: number } ? Omit<Command, 'id'> : never : never, laneOverride?: RecordsLane): Promise<T> {
  if ('account' in command && 'key' in command) registerRecallMediaAccount(command.account.root, command.key)
  return new Promise((resolve, reject) => {
    const lane: RecordsLane = laneOverride ?? (command.type === 'apply-exclusions' || command.type === 'chat-index' ? 'indexing' : command.type === 'report' || command.type === 'report-media' || command.type === 'report-participants' ? 'reports' : command.type === 'index-search' || command.type === 'index-conversation' || command.type === 'speech' || command.type === 'conversation-summary' ? 'statistics' : 'records')
    const child = recordsProcess(lane)
    const id = ++nextId
    // A native read may stop responding.
    // Expired report requests release their pending entry; late replies are ignored.
    const timer = lane === 'reports' ? setTimeout(() => {
      const error = new Error('读取报告记录超时，请重试')
      pending.delete(id)
      reject(error)
      // A stuck native call cannot be interrupted within the worker. Retire only
      // this lane so retries start fresh and unrelated work keeps running.
      if (processInstances.get(lane) === child) processInstances.delete(lane)
      for (const [otherId, task] of pending) {
        if (task.child !== child) continue
        pending.delete(otherId)
        task.reject(error)
      }
      child.kill()
    }, 180_000) : undefined
    const cleanup = (): void => { if (timer) clearTimeout(timer) }
    pending.set(id, { child, resolve: result => { cleanup(); resolve(result as T) }, reject: error => { cleanup(); reject(error) } })
    try { child.postMessage({ ...command, id }) } catch (error) { cleanup(); pending.delete(id); reject(error) }
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
  for (const lane of ['records', 'reports'] as const) {
    if (!processInstances.has(lane)) continue
    const preview = await request<PreviewData | null>({ type: 'image', imageId: id }, lane)
    if (!preview) continue
    cacheImagePreview(Buffer.from(preview.data), preview.mime)
    return readImagePreview(id)
  }
  return undefined
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

export async function runWechatChatIndex(account: WechatAccount, key: string, action: ChatIndexAction, excludedConversationIds?: string[]): Promise<ChatIndexStatus> {
  const id = identity(account.root, key)
  if (action === 'exclusions') {
    // Persist before contacting any worker. A long native index query must not
    // block the policy change; workers consult this file at batch boundaries.
    const rooms = saveExcludedConversations(account.root, excludedConversationIds)
    void request<void>({ type: 'apply-exclusions', account, key }).catch(error => console.error('排除名单已保存，索引清理失败:', error instanceof Error ? error.message : String(error)))
    return { ...(indexStatuses.get(id) ?? { state: 'idle', messages: 0, conversations: 0, completedStores: 0, totalStores: 0, current: '', updatedAt: null, errors: [] }), excludedConversationIds: rooms }
  }
  const status = await request<ChatIndexStatus>({ type: 'chat-index', account, key, action })
  indexStatuses.set(id, status)
  // An older status response must not overwrite a newly saved exclusion list.
  return { ...status, excludedConversationIds: excludedConversations(account.root) }
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

export function runConversationOptions(account: WechatAccount, key: string): Promise<import('../shared/types').ConversationOption[]> {
  return request({ type: 'conversation-options', account, key })
}

export function runGroupMonitor(account: WechatAccount, key: string, query: import('../shared/group-monitor').MonitorQuery): Promise<import('../shared/group-monitor').MonitorState> {
  return request({ type: 'group-monitor', account, key, query })
}

export function runStickerUrl(account: WechatAccount, key: string, md5: string): Promise<string | null> { return request({ type: 'sticker-url', account, key, md5 }) }
