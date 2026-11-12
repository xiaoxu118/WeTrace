import { retainMedia, excludeRecallMedia } from './recall-media-store'
import { readLocalVideo } from './local-video'
import { readImagePreview } from './image-preview-cache'
import { recallCaptureWindow } from './recall-capture-window'
import { captureChatRecalls } from './chat-recall-capture.ts'
import { retainedRecallMessages } from '../shared/retained-recalls.ts'
import { loadMonitor, saveMonitor, observeRoom, updateMonitorForSync } from './group-monitor'
import { excludedConversations, saveExcludedConversations, conversationCacheAllowed } from './conversation-cache-policy'
import { join } from 'node:path'
import { reportSelectionKey, validateReportSelection } from '../shared/report-selection'
import type { ReportParticipant } from '../shared/report-facts'
import { ChatIndex } from './chat-index'
import type { ChatIndexSearchMatch, ChatIndexAction, ChatIndexStatus } from '../shared/chat-index'
import { ReportDiskIndex } from './report-disk-index'
import { sourceFingerprint } from './speech-index'
import { createHash } from 'node:crypto'
import { ReportRecordCache } from './report-record-cache'
import { findSilentMembers } from '../shared/speech-stats'
import type { ConversationIndexSummary, SpeechStatsQuery, SpeechStatsResult } from '../shared/types'
import { reportContentType, reportDateTimestamp } from '../shared/report-messages'
import { localImages, presentMessage } from './message-content'
import { Wcdb4Client, type WcdbMessage } from './wcdb4-client'
import type { ReportContentType, ReportMessagesFilter, ReportMessagesResult, SyncConversation, SyncMessage, SyncResult, WechatAccount } from '../shared/types'

function recordsFingerprint(root: string): string {
  return createHash('sha256').update(JSON.stringify([sourceFingerprint(root), excludedConversations(root)])).digest('hex')
}

const MAX_CONVERSATIONS = 120
const MESSAGE_PAGE_SIZE = 60
const REPORT_PAGE_SIZE = 500
const reportContentTypes: ReportContentType[] = ['message', 'voice', 'image', 'video']
const syncClients = new Map<string, { key: string; client: Wcdb4Client }>()

function recordsClient(account: WechatAccount, key: string): Wcdb4Client {
  const cached = syncClients.get(account.root)
  const client = cached?.key === key ? cached.client : new Wcdb4Client(key, account.root)
  if (!cached || cached.key !== key) syncClients.set(account.root, { key, client })
  return client
}

const chatIndexes = new Map<string, ChatIndex>()
const appliedExclusions = new Map<string, string>()
function chatIndex(directory: string, account: WechatAccount, key: string): ChatIndex {
  const identity = createHash('sha256').update(JSON.stringify([directory, account.root, key])).digest('hex')
  let index = chatIndexes.get(identity)
  if (!index) { index = new ChatIndex(directory, account.root, key, account.wxid); chatIndexes.set(identity, index) }
  const rooms = excludedConversations(account.root), policy = JSON.stringify(rooms)
  if (appliedExclusions.get(identity) !== policy) {
    index.exclude(rooms)
    appliedExclusions.set(identity, policy)
  }
  return index
}

function readChatIndex<T>(directory: string, account: WechatAccount, key: string, read: (index: ChatIndex) => T): T | undefined {
  let index: ChatIndex | undefined
  try {
    index = new ChatIndex(directory, account.root, key, account.wxid, { readOnly: true })
    return read(index)
  } catch { return undefined }
  finally { index?.close() }
}

function reportIndexMatchesSource(indexed: ConversationIndexSummary, client: Wcdb4Client, conversationId: string): boolean {
  const current = client.aggregateConversation(conversationId) as ConversationIndexSummary
  return indexed.total === current.total && indexed.firstAt === current.firstAt && indexed.lastAt === current.lastAt
}

export function controlWechatChatIndex(directory: string, account: WechatAccount, key: string, action: ChatIndexAction, excludedConversationIds?: string[]): ChatIndexStatus {
  if (action === 'exclusions') {
    saveExcludedConversations(account.root, excludedConversationIds)
    applyWechatCacheExclusions(directory, account, key)
  }
  const index = chatIndex(directory, account, key)
  if (action === 'pause') return { ...index.pause(), excludedConversationIds: excludedConversations(account.root) }
  if (action === 'start' || action === 'rebuild' || action === 'sync' && index.status().state !== 'paused') {
    void index.start({ ...recordsClient(account, key).indexSource(), fingerprint: () => recordsFingerprint(account.root), excluded: room => !conversationCacheAllowed(account.root, room) }, action === 'rebuild').catch(error => console.error('聊天索引更新失败:', error instanceof Error ? error.message : String(error)))
  }
  return { ...index.status(), excludedConversationIds: excludedConversations(account.root) }
}

export function applyWechatCacheExclusions(directory: string, account: WechatAccount, key: string): void {
  const rooms = excludedConversations(account.root)
  excludeRecallMedia(account.root, rooms)
  chatIndex(directory, account, key).exclude(rooms)
  reportRecordCache.exclude(account.root, rooms)
  new ReportDiskIndex(join(directory, '..', 'cache', 'report-index')).exclude(account.root, key, rooms)
}

function presentRetainedMessage(account: WechatAccount, key: string, room: string, row: WcdbMessage, images: Map<string, string[]>): ReturnType<typeof presentMessage> & Pick<SyncMessage, 'video'> {
  const message = presentMessage(row.type, row.content, images, row.imageFileHash)
  try {
    if (message.image?.source && conversationCacheAllowed(account.root, room)) {
      const id = /^wetrace-media:\/\/preview\/([a-f0-9]{64})$/.exec(message.image.source)?.[1]
      const preview = id ? readImagePreview(id) : undefined
      const source = preview && retainMedia(account.root, key, room, preview.data, preview.mime)
      if (source) message.image = { ...message.image, source }
    }
    if ([43, 62].includes(row.type >>> 0)) {
      const data = readLocalVideo(account.root, room, row.content, row.imageFileHash, hash => recordsClient(account, key).resolveVideoFilename(hash))
      const source = data && retainMedia(account.root, key, room, data, 'video/mp4')
      return { ...message, video: source ? { source } : { unavailable: data ? '视频尚未保存' : '视频尚未下载到本机或格式暂不支持' } }
    }
  } catch { /* Optional media storage must not interrupt message capture. */ }
  return message
}

function clock(seconds: number): string {
  const date = new Date(seconds * 1000)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function dayLabel(seconds: number): string {
  const date = new Date(seconds * 1000)
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

function monthLabel(seconds: number): string {
  const date = new Date(seconds * 1000)
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function syncWechatRecords(account: WechatAccount, key: string, indexDirectory?: string): SyncResult {
  const client = recordsClient(account, key)
  const sessions = client
    .getSessions()
    .sort((left, right) => right.lastActive - left.lastActive)
  const profile = client.getSelfProfile()

  let previousCapture: import('../shared/group-monitor').MonitorState | undefined
  if (indexDirectory) { try { previousCapture = loadMonitor(join(indexDirectory, '..', 'group-monitor'), account.root, key) } catch { /* The existing sync warning reports persistence failures. */ } }
  const truncatedCaptures = new Set<string>()
  const conversations: SyncConversation[] = []
  const profileUsernames = new Set<string>()
  let messageTotal = 0

  for (const session of sessions) {
    if (conversations.length >= MAX_CONVERSATIONS) break
    const username = session.username
    if (!username || username === 'filehelper') continue

    let rows
    try {
      const capture = recallCaptureWindow((limit, offset) => client.getMessages(username, limit, offset), previousCapture?.rooms.find(room => room.id === username)?.checkedAt)
      rows = capture.rows.sort((a, b) => a.createTime - b.createTime)
      if (capture.truncated) truncatedCaptures.add(username)
    } catch {
      continue
    }
    if (!rows.length) continue

    profileUsernames.add(username)
    const isGroup = username.endsWith('@chatroom')
    const images = localImages(account.root, username)
    const messages: SyncMessage[] = rows.map((row) => {
      const mine = row.isSend || row.sender === account.wxid
      if (isGroup && !mine && row.sender) profileUsernames.add(row.sender)
      return {
        id: row.id, serverId: row.serverId,
        createdAt: row.createTime * 1000,
        messageType: row.type,
        from: mine ? 'me' : 'them',
        senderId: isGroup ? (mine ? account.wxid : row.sender || undefined) : undefined,
        sender: isGroup && !mine ? row.sender || undefined : undefined,
        ...presentRetainedMessage(account, key, username, row, images),
        time: clock(row.createTime),
      }
    })
    const first = rows[0]
    const last = rows[rows.length - 1]

    conversations.push({
      id: username,
      name: session.nickname || username,
      type: isGroup ? 'group' : username.startsWith('gh_') || ['brandsessionholder', 'notification_messages', 'newsapp', 'weixin', 'officialaccounts'].includes(username) ? 'official' : 'friend',
      time: clock(session.lastActive || last.createTime),
      preview: messages[messages.length - 1]?.text ?? '',
      unread: session.unreadCount || undefined,
      records: rows.length.toLocaleString('en-US'),
      range: `${monthLabel(first.createTime)} — ${monthLabel(last.createTime)}`,
      day: dayLabel(last.createTime),
      messages,
    })
    messageTotal += rows.length
  }

  if (!conversations.length) {
    throw new Error('数据库已解密，但没有找到可读取的会话消息')
  }

  for (const conversation of conversations) {
    const ids = new Set(conversation.messages.map(message => message.id))
    const targets = new Set(conversation.messages.map(message => message.revoke?.targetId).filter(Boolean))
    for (const original of previousCapture?.rooms.find(room => room.id === conversation.id)?.messages ?? []) {
      if (original.senderId && (ids.has(original.id) || original.revokeNoticeId && ids.has(original.revokeNoticeId) || original.serverId && targets.has(original.serverId))) profileUsernames.add(original.senderId)
    }
  }
  const profiles = client.getProfiles([...profileUsernames])
  for (const conversation of conversations) {
    const conversationProfile = profiles.get(conversation.id)
    conversation.name = conversationProfile?.nickname || conversation.name
    conversation.avatar = conversationProfile?.avatar
    const groupNames = conversation.type === 'group' ? client.getGroupNicknames(conversation.id) : new Map<string, string>()
    for (const message of conversation.messages) {
      const senderId = message.senderId ?? message.sender
      if (!senderId) continue
      const senderProfile = profiles.get(senderId)
      message.avatar = senderProfile?.avatar
      message.sender = groupNames.get(senderId) || senderProfile?.nickname || message.sender
    }
  }

  let monitorWarning: string | undefined
  if (indexDirectory) {
    const directory = join(indexDirectory, '..', 'group-monitor')
    monitorWarning = updateMonitorForSync(directory, account.root, key, state => {
      state.rooms = state.rooms.filter(room => conversationCacheAllowed(account.root, room.id))
      for (const conversation of conversations) if (conversationCacheAllowed(account.root, conversation.id)) {
        const room = state.rooms.find(item => item.id === conversation.id)
        if (room && truncatedCaptures.has(conversation.id)) room.captureGap = true
        captureChatRecalls(state, conversation, Date.now(), readImagePreview, senderId => profiles.get(senderId)?.avatar)
      }
    })
  }

  for (const conversation of conversations) { conversation.messages = conversation.messages.slice(-MESSAGE_PAGE_SIZE); conversation.records = conversation.messages.length.toLocaleString('en-US') }
  messageTotal = conversations.reduce((sum, conversation) => sum + conversation.messages.length, 0)
  return {
    account: {
      ...account,
      nickname: profile.nickname || account.wxid,
      avatar: profile.avatar,
    },
    conversations,
    messageTotal,
    ...(monitorWarning ? { monitorWarning } : {}),
    syncedAt: new Date().toISOString(),
  }
}

function readWechatReportMessages(
  account: WechatAccount,
  key: string,
  query: ReportMessagesFilter,
  indexDirectory?: string
): ReportMessagesResult {
  const conversationId = typeof query.conversationId === 'string' ? query.conversationId.trim() : ''
  if (!conversationId) throw new Error('请选择要生成报告的会话')
  if (!Array.isArray(query.contentTypes) || query.contentTypes.some(type => !reportContentTypes.includes(type))) {
    throw new Error('报告内容类型无效')
  }
  const selectedTypes = new Set(query.contentTypes)
  if (!selectedTypes.size) throw new Error('请至少选择一种报告内容类型')

  const startAt = reportDateTimestamp(query.startDate)
  const endAt = reportDateTimestamp(query.endDate, true)
  if (startAt >= endAt) throw new Error('报告开始日期不能晚于结束日期')

  const client = recordsClient(account, key)
  const counts: Record<ReportContentType, number> = { message: 0, voice: 0, image: 0, video: 0 }
  let selectedRows: WcdbMessage[] = []
  let offset = 0

  if (query.selectedMessages) validateReportSelection(query.selectedMessages)
  let indexed = false
  let index: ChatIndex | undefined
  try {
    index = indexDirectory ? new ChatIndex(indexDirectory, account.root, key, account.wxid, { readOnly: true }) : undefined
    if (index?.hasConversation(conversationId) && (query.indexRevision || reportIndexMatchesSource(index.summary(conversationId), client, conversationId))) {
      if (query.selectedMessages) {
        selectedRows = index.selectedReportMessages(conversationId, query.selectedMessages)
        for (const row of selectedRows) counts[reportContentType(row.type)]++
        const found = new Set(selectedRows.map(row => reportSelectionKey({ id: row.id, createdAt: row.createTime * 1000 })))
        indexed = query.selectedMessages.every(item => found.has(reportSelectionKey({ id: item.id, createdAt: item.createdAt })))
      } else {
        const content = index.reportContent(conversationId, startAt, endAt, query.contentTypes, query.indexRevision)
        Object.assign(counts, content.counts)
        selectedRows = content.rows.slice()
        indexed = Object.values(counts).some(count => count > 0)
      }
    }
  } catch (error) {
    // A changed selection must still be confirmed by the user. Index locks,
    // incomplete stores and read failures can safely use the original records.
    if (error instanceof Error && error.message === '会话索引已更新，请重新选择会话后生成报告') throw error
  } finally { index?.close() }
  if (!indexed) {
    selectedRows = []
    for (const type of reportContentTypes) counts[type] = 0
    const deadline = Date.now() + 120_000
    while (true) {
      if (Date.now() >= deadline) throw new Error('读取报告原始记录超时，请稍后重试')
      const rows = client.getMessages(conversationId, REPORT_PAGE_SIZE, offset)
      if (Date.now() >= deadline) throw new Error('读取报告原始记录超时，请稍后重试')
      if (!rows.length) break
      let reachedStart = false
      for (const row of rows) {
        const createdAt = row.createTime * 1000
        if (createdAt < startAt) { reachedStart = true; continue }
        if (createdAt >= endAt) continue
        const contentType = reportContentType(row.type)
        counts[contentType] += 1
        if (selectedTypes.has(contentType)) selectedRows.push(row)
      }
      offset += rows.length
      if (rows.length < REPORT_PAGE_SIZE || reachedStart) break
    }
  }

  if (query.selectedMessages) {
    const selected = new Set(query.selectedMessages.map(item => reportSelectionKey({ id: item.id, createdAt: item.createdAt })))
    const kept = selectedRows.filter(row => selected.has(reportSelectionKey({ id: row.id, createdAt: row.createTime * 1000 })))
    selectedRows = kept
  }
  selectedRows.sort((left, right) => left.createTime - right.createTime)
  const isGroup = conversationId.endsWith('@chatroom')
  const images = query.deferMedia ? new Map<string, string[]>() : localImages(account.root, conversationId)
  const profileUsernames = new Set<string>([account.wxid])
  const messages: SyncMessage[] = selectedRows.map(row => {
    const mine = row.isSend || row.sender === account.wxid
    if (isGroup && !mine && row.sender) profileUsernames.add(row.sender)
    return {
      id: row.id,
      createdAt: row.createTime * 1000,
      messageType: row.type,
      from: mine ? 'me' : 'them',
      senderId: mine ? account.wxid : isGroup ? row.sender || undefined : conversationId,
      sender: isGroup && !mine ? row.sender || undefined : undefined,
      ...(query.deferMedia && [3, 34].includes(row.type)
        ? { text: row.type === 3 ? '[图片]' : '[语音]', reportMedia: { content: row.content, serverId: row.serverId, imageFileHash: row.imageFileHash } }
        : presentMessage(row.type, row.content, images, row.imageFileHash)),
      ...(row.type === 34 && query.includeVoiceData && !query.deferMedia ? { voice: client.getVoiceData(conversationId, row) } : {}),
      time: clock(row.createTime),
    }
  })

  const names = client.getDisplayNames([...profileUsernames])
  const groupNames = isGroup ? client.getGroupNicknames(conversationId) : new Map<string, string>()
  for (const message of messages) {
    const senderId = message.senderId ?? message.sender
    if (!senderId) continue
    message.sender = groupNames.get(senderId) || names.get(senderId) || message.sender
  }

  return {
    conversationId,
    startDate: query.startDate,
    endDate: query.endDate,
    contentTypes: reportContentTypes.filter(type => selectedTypes.has(type)),
    messages,
    counts,
  }
}

export function queryWechatSpeechStats(directory: string, account: WechatAccount, key: string, query: SpeechStatsQuery): SpeechStatsResult {
  const client = recordsClient(account, key)
  if (!query.conversationId?.endsWith('@chatroom')) throw new Error('请选择群聊')
  const start = query.startDate ? reportDateTimestamp(query.startDate) : 0
  const end = query.endDate ? reportDateTimestamp(query.endDate, true) : 253402300800000
  if (start >= end) throw new Error('开始日期不能晚于结束日期')
  const indexed = conversationCacheAllowed(account.root, query.conversationId) ? readChatIndex(directory, account, key, index => index.hasConversation(query.conversationId) && index.isFresh(recordsFingerprint(account.root)) ? index.speech(query.conversationId, start, end) : undefined) : undefined
  const stats = indexed ?? client.aggregateConversation(query.conversationId, { start, end, selfId: account.wxid }) as SpeechStatsResult
  try {
    stats.silentMembers = findSilentMembers(client.getGroupMemberIds(query.conversationId), stats.members)
  } catch (error) {
    stats.membershipError = error instanceof Error ? error.message : '读取群成员失败'
  }
  for (const member of stats.members) member.isSelf = member.id === account.wxid
  const names = client.getDisplayNames([...stats.members, ...(stats.silentMembers ?? [])].map(member => member.id).filter(Boolean))
  const groupNames = client.getGroupNicknames(query.conversationId)
  for (const member of [...stats.members, ...(stats.silentMembers ?? [])]) member.name = member.id === account.wxid ? '我' : groupNames.get(member.id) || names.get(member.id) || member.name
  stats.silentMembers?.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return stats
}

export function queryWechatConversationSummary(directory: string, account: WechatAccount, key: string, conversationId: string): ConversationIndexSummary {
  const client = recordsClient(account, key)
  const indexed = conversationCacheAllowed(account.root, conversationId) ? readChatIndex(directory, account, key, index => index.hasConversation(conversationId) && index.isFresh(recordsFingerprint(account.root)) ? index.summary(conversationId) : undefined) : undefined
  return indexed ?? client.aggregateConversation(conversationId) as ConversationIndexSummary
}

export function prepareWechatReportMedia(account: WechatAccount, key: string, conversationId: string, message: SyncMessage): SyncMessage {
  const media = message.reportMedia
  if (!media) return message
  if (message.messageType === 34) {
    const voice = recordsClient(account, key).getVoiceData(conversationId, { id: message.id, createTime: Math.floor(message.createdAt / 1000), type: 34, content: media.content, serverId: media.serverId, isSend: message.from === 'me', sender: message.senderId || '' })
    return { ...message, voice }
  }
  if (message.messageType === 3) return { ...message, ...presentMessage(3, media.content, localImages(account.root, conversationId), media.imageFileHash) }
  return message
}

const reportRecordCache = new ReportRecordCache()
export function queryWechatReportMessages(account: WechatAccount, key: string, query: ReportMessagesFilter, indexDirectory?: string, chatDirectory?: string): ReportMessagesResult {
  const allowed = conversationCacheAllowed(account.root, query.conversationId)
  if (!allowed) return readWechatReportMessages(account, key, query)
  if (query.metadataOnly) {
    const start = reportDateTimestamp(query.startDate), end = reportDateTimestamp(query.endDate, true)
    if (start >= end) throw new Error('报告开始日期不能晚于结束日期')
    if (!Array.isArray(query.contentTypes) || query.contentTypes.some(type => !reportContentTypes.includes(type))) throw new Error('报告内容类型无效')
    if (!query.contentTypes.length) throw new Error('请至少选择一种报告内容类型')
    let selection: ReturnType<ChatIndex['reportSelection']> | undefined
    let index: ChatIndex | undefined
    try {
      index = chatDirectory ? new ChatIndex(chatDirectory, account.root, key, account.wxid, { readOnly: true }) : undefined
      if (index?.hasConversation(query.conversationId)) {
        const candidate = index.reportSelection(query.conversationId, start, end)
        if (reportIndexMatchesSource(candidate.summary, recordsClient(account, key), query.conversationId)) selection = candidate
      }
    } catch { /* Busy, rebuilding or unavailable indexes fall back to original records. */ }
    finally { index?.close() }
    // Keep full originals in the report snapshot when metadata is unavailable.
    if (!selection?.rows.length) return readWechatReportMessages(account, key, query)
    const rows = selection.rows
    const client = recordsClient(account, key)
    const ids = [...new Set(rows.map(row => row.sender).filter(Boolean))]
    const names = client.getDisplayNames(ids)
    const groupNames = query.conversationId.endsWith('@chatroom') ? client.getGroupNicknames(query.conversationId) : new Map<string, string>()
    const counts: Record<ReportContentType, number> = { message: 0, voice: 0, image: 0, video: 0 }
    const selected = new Set(query.contentTypes)
    const messages: SyncMessage[] = []
    for (const row of rows) {
      const type = reportContentType(row.type)
      counts[type] += row.count
      if (!selected.has(type)) continue
      messages.push({ id: row.id, createdAt: row.time, count: row.count, messageType: row.type, from: row.sender === account.wxid ? 'me' : 'them', senderId: row.sender || undefined, sender: groupNames.get(row.sender) || names.get(row.sender) || row.sender || undefined, text: '', time: '' })
    }
    return { ...query, counts, messages, indexRevision: selection.revision }
  }
  if (chatDirectory) return readWechatReportMessages(account, key, query, chatDirectory)
  if (!query.deferMedia) return readWechatReportMessages(account, key, query, chatDirectory)
  const identity = createHash('sha256').update(JSON.stringify(['report-v2-members', account.root, key, query])).digest('hex')
  return reportRecordCache.get(identity, () => recordsFingerprint(account.root), () => {
    const read = () => readWechatReportMessages(account, key, query, chatDirectory)
    return indexDirectory ? new ReportDiskIndex(indexDirectory).get(account.root, key, identity, () => recordsFingerprint(account.root), read) : read()
  }, account.root, query.conversationId)
}

export function searchWechatChatIndex(directory: string, account: WechatAccount, key: string, keyword: string): ChatIndexSearchMatch[] {
  const excluded = new Set(excludedConversations(account.root))
  const found = (readChatIndex(directory, account, key, index => index.search(keyword)) ?? []).filter(row => !excluded.has(row.room))
  const names = recordsClient(account, key).getDisplayNames(found.map(row => row.room))
  return found.map(({ room, message }) => ({ conversationId: room, conversationName: names.get(room) || room, id: message.id, createdAt: message.createTime * 1000, text: presentMessage(message.type, message.content, new Map()).text }))
}

export function readIndexedConversation(directory: string, account: WechatAccount, key: string, conversationId: string, at?: number, limit = MESSAGE_PAGE_SIZE, refresh = false): SyncConversation {
  const client = recordsClient(account, key)
  const indexed = !refresh && conversationCacheAllowed(account.root, conversationId) ? readChatIndex(directory, account, key, index => index.hasConversation(conversationId) && (at !== undefined || index.isFresh(recordsFingerprint(account.root)))
    ? { rows: index.messages(conversationId, 0, at === undefined ? undefined : at + 1, limit), summary: index.summary(conversationId) } : undefined) : undefined
  if (!indexed && at !== undefined) throw new Error('该会话索引尚未完成')
  const rows = indexed ? indexed.rows : client.getMessages(conversationId, limit)
  const profiles = client.getProfiles([conversationId, account.wxid, ...rows.map(row => row.sender)])
  const groupNames = conversationId.endsWith('@chatroom') ? client.getGroupNicknames(conversationId) : new Map<string, string>()
  const images = localImages(account.root, conversationId)
  const messages: SyncMessage[] = rows.map(row => ({
    id: row.id, serverId: row.serverId, createdAt: row.createTime * 1000, messageType: row.type,
    from: row.isSend || row.sender === account.wxid ? 'me' : 'them',
    senderId: row.isSend || row.sender === account.wxid ? account.wxid : row.sender || (conversationId.endsWith('@chatroom') ? undefined : conversationId),
    sender: groupNames.get(row.sender) || profiles.get(row.sender)?.nickname || row.sender,
    avatar: profiles.get(row.isSend || row.sender === account.wxid ? account.wxid : row.sender || conversationId)?.avatar,
    ...presentRetainedMessage(account, key, conversationId, row, images), time: clock(row.createTime),
  }))
  const summary = indexed ? indexed.summary : client.aggregateConversation(conversationId) as ConversationIndexSummary
  return { id: conversationId, name: profiles.get(conversationId)?.nickname || conversationId, avatar: profiles.get(conversationId)?.avatar,
    type: conversationId.endsWith('@chatroom') ? 'group' : conversationId.startsWith('gh_') ? 'official' : 'friend',
    time: rows.length ? clock(rows[rows.length - 1].createTime) : '', preview: messages[messages.length - 1]?.text || '',
    records: summary.total.toLocaleString('en-US'), range: summary.firstAt === null ? '' : `${monthLabel(summary.firstAt / 1000)} — ${monthLabel(summary.lastAt! / 1000)}`,
    day: rows.length ? dayLabel(rows[rows.length - 1].createTime) : '', messages: conversationCacheAllowed(account.root, conversationId) ? retainedRecallMessages(messages, loadMonitor(join(directory, '..', 'group-monitor'), account.root, key).rooms.find(room => room.id === conversationId)) : messages }
}

export function loadReportParticipantProfiles(account: WechatAccount, key: string, participants: ReportParticipant[]): ReportParticipant[] {
  const top = participants.slice(0, 5).map(member => ({ ...member, id: member.id || (member.key === 'self' ? account.wxid : undefined) }))
  const profiles = recordsClient(account, key).getProfiles(top.flatMap(member => member.id ? [member.id] : []))
  return top.map(member => ({ ...member, name: member.name && member.name !== '我' ? member.name : (member.id ? profiles.get(member.id)?.nickname || member.id : '未知成员'), avatar: member.id ? profiles.get(member.id)?.avatar || member.avatar : member.avatar }))
}

// Read the complete session directory without loading message bodies or applying the UI page limit.
export function listWechatConversationOptions(account: WechatAccount, key: string): import('../shared/types').ConversationOption[] {
  const client = recordsClient(account, key)
  const sessions = client.getSessions().filter(item => item.username && item.username !== 'filehelper').sort((a, b) => b.lastActive - a.lastActive)
  const profiles = client.getProfiles(sessions.map(item => item.username))
  return sessions.map(item => ({
    id: item.username, name: profiles.get(item.username)?.nickname || item.nickname || item.username,
    avatar: profiles.get(item.username)?.avatar,
    type: item.username.endsWith('@chatroom') ? 'group' : item.username.startsWith('gh_') || ['brandsessionholder', 'notification_messages', 'newsapp', 'weixin', 'officialaccounts'].includes(item.username) ? 'official' : 'friend',
  }))
}

export function queryGroupMonitor(directory: string, account: WechatAccount, key: string, query: import('../shared/group-monitor').MonitorQuery): import('../shared/group-monitor').MonitorState {
  const state = loadMonitor(directory, account.root, key)
  if (!['status', 'poll', 'configure'].includes(query.action)) throw new Error('不支持该监控操作')
  if (query.action === 'configure') {
    if (!Array.isArray(query.rooms) || query.rooms.length > 100 || query.rooms.some(room => typeof room.id !== 'string' || !room.id.endsWith('@chatroom') || typeof room.enabled !== 'boolean')) throw new Error('请选择有效群聊（最多 100 个）')
    if (query.rooms.some(room => room.eventKinds !== undefined && (!Array.isArray(room.eventKinds) || !room.eventKinds.length || room.eventKinds.some(kind => !['message', 'left', 'joined'].includes(kind))))) throw new Error('请选择有效的监控事件类型')
    for (const input of query.rooms) {
      let room = state.rooms.find(item => item.id === input.id)
      if (!room) { room = { id: input.id, name: String(input.name || input.id).slice(0, 200), enabled: false, startedAt: Date.now(), messages: [] }; state.rooms.push(room) }
      if (!room.enabled && input.enabled) { room.startedAt = Date.now(); room.checkedAt = undefined; room.members = undefined }
      if (input.eventKinds) room.eventKinds = [...new Set(input.eventKinds)]
      room.enabled = input.enabled
      room.name = String(input.name || input.id).slice(0, 200)
    }
  }
  if (query.action === 'poll') {
    const client = recordsClient(account, key)
    for (const room of state.rooms.filter(item => item.enabled)) {
      room.error = undefined
      if (!conversationCacheAllowed(account.root, room.id)) { room.error = '该群已被排除本地缓存，请先在索引设置中取消排除'; continue }
      try {
        const rows: WcdbMessage[] = []
        let truncated = false
        for (let offset = 0; offset < 10000; offset += 200) {
          const page = client.getMessages(room.id, 200, offset)
          rows.push(...page)
          if (!room.checkedAt || page.length < 200 || page.some(row => row.createTime * 1000 < room.checkedAt! - 180000)) break
          if (offset === 9800) truncated = true
        }
        const names = client.getDisplayNames(rows.map(row => row.sender).filter(Boolean))
        const groupNames = client.getGroupNicknames(room.id)
        let members: Record<string, string> | undefined
        try {
          const ids = client.getGroupMemberIds(room.id)
          const profiles = client.getDisplayNames(ids)
          members = Object.fromEntries(ids.map(id => [id, groupNames.get(id) || profiles.get(id) || id]))
        } catch (error) { room.error = `成员监控暂不可用：${error instanceof Error ? error.message : String(error)}` }
        observeRoom(state, room, rows.sort((a, b) => a.createTime - b.createTime).map(row => ({
          id: row.id, serverId: row.serverId, at: row.createTime * 1000, type: row.type,
          from: row.isSend || row.sender === account.wxid ? 'me' : 'them', senderId: row.sender || undefined,
          sender: row.isSend || row.sender === account.wxid ? '我' : groupNames.get(row.sender) || names.get(row.sender) || row.sender || '系统',
          text: [10000, 10002].includes(row.type) ? row.content : presentMessage(row.type, row.content, new Map()).text,
        })), members, Date.now())
        if (truncated) room.error = '本次新增记录超过 10000 条，可能存在监控缺口'
      } catch (error) { room.error = error instanceof Error ? error.message : '监控读取失败' }
    }
  }
  if (query.action !== 'status') saveMonitor(directory, account.root, key, state)
  return state
}

export function queryStickerCdnUrl(account: WechatAccount, key: string, md5: string): string | null { return recordsClient(account, key).resolveEmoticonCdnUrl(md5) || null }
