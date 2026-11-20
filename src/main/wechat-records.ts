import type { ChatExportQuery } from '../shared/chat-export'
import { serializeChatExport } from './chat-export'
import type { ProfileAvatar, ProfileMessage, ProfileMessagePage, ProfilePageQuery } from '../shared/person-profile'
import { SyncPresentationCache } from './sync-presentation-cache'
import { refreshOriginalImage } from './recall-original-image'
import { recoverCapturedAttachments } from './recall-attachment-recovery'
import { readLocalAttachment } from './local-attachment'
import { retainMedia, excludeRecallMedia } from './recall-media-store'
import { inspectLocalVideoHashes, videoUnavailable, videoHashes } from './local-video'
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
  syncPresentations.clear(account.root)
  excludeRecallMedia(account.root, rooms)
  chatIndex(directory, account, key).exclude(rooms)
  reportRecordCache.exclude(account.root, rooms)
  new ReportDiskIndex(join(directory, '..', 'cache', 'report-index')).exclude(account.root, key, rooms)
}

const syncPresentations = new SyncPresentationCache()
const presentationPolicies = new Map<string, string>()
export function invalidateSyncMedia(root: string, path?: string): void { syncPresentations.invalidate(root, path) }

function presentRetainedMessage(account: WechatAccount, key: string, room: string, row: WcdbMessage, images: Map<string, string[]>): ReturnType<typeof presentMessage> & Pick<SyncMessage, 'video'> {
  const message = presentMessage(row.type, row.content, images, row.imageFileHash)
  try {
    if (message.image?.source && conversationCacheAllowed(account.root, room)) {
      const id = /^wetrace-media:\/\/preview\/([a-f0-9]{64})$/.exec(message.image.source)?.[1]
      const preview = id ? readImagePreview(id) : undefined
      const source = preview && retainMedia(account.root, key, room, preview.data, preview.mime)
      if (source) message.image = { ...message.image, source }
    }
    if (message.file) {
      const attachment = readLocalAttachment(account.root, room, message.file)
      const source = attachment && retainMedia(account.root, key, room, attachment.data, attachment.mime)
      message.file = { ...message.file, ...(source ? { source } : { unavailable: '未留存文件内容' }) }
      if (source && attachment?.mime.startsWith('image/')) message.image = { source, thumbnail: false }
      if (source && attachment?.mime === 'video/mp4') Object.assign(message, { video: { source } })
    }
    if ([43, 62].includes(row.type >>> 0)) {
      const hashes = videoHashes(row.content, row.imageFileHash)
      const { data, reason } = inspectLocalVideoHashes(account.root, room, hashes, hash => recordsClient(account, key).resolveVideoFilename(hash))
      const source = data && retainMedia(account.root, key, room, data, 'video/mp4')
      return { ...message, video: { hashes, ...(source ? { source } : { unavailable: data ? '视频尚未保存' : videoUnavailable(reason || 'not-found') }) } }
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

function conversationType(id: string, isVerifiedAccount?: boolean): SyncConversation['type'] {
  if (id.endsWith('@chatroom')) return 'group'
  const username = id.toLowerCase()
  return isVerifiedAccount || username.startsWith('gh_') ||
    ['brandsessionholder', 'notification_messages', 'newsapp', 'weixin', 'officialaccounts'].includes(username)
    ? 'official' : 'friend'
}

export function syncWechatRecords(account: WechatAccount, key: string, indexDirectory?: string): SyncResult {
  const client = recordsClient(account, key)
  const policy = JSON.stringify(excludedConversations(account.root))
  if (presentationPolicies.get(account.root) !== policy) { syncPresentations.clear(account.root); presentationPolicies.set(account.root, policy) }
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
      const cached = indexDirectory && conversationCacheAllowed(account.root, username)
        ? readChatIndex(indexDirectory, account, key, index => index.hasConversation(username) ? index.messages(username, 0, undefined, MESSAGE_PAGE_SIZE) : undefined)
        : undefined
      if (cached?.length) rows = cached.sort((a, b) => a.createTime - b.createTime)
      else {
        const capture = recallCaptureWindow((limit, offset) => client.getMessages(username, limit, offset), previousCapture?.rooms.find(room => room.id === username)?.checkedAt)
        rows = capture.rows.sort((a, b) => a.createTime - b.createTime)
        if (capture.truncated) truncatedCaptures.add(username)
      }
    } catch {
      continue
    }
    if (!rows.length) continue

    profileUsernames.add(username)
    const isGroup = username.endsWith('@chatroom')
    const firstConversation = conversations.length === 0
    const images = firstConversation ? localImages(account.root, username, hash => client.resolveImagePath(hash)) : new Map<string, string[]>()
    const messages: SyncMessage[] = rows.map((row) => {
      const mine = row.isSend || row.sender === account.wxid
      if (isGroup && !mine && row.sender) profileUsernames.add(row.sender)
      const presentation = firstConversation
        ? syncPresentations.read(account.root, key, username, row, () => presentRetainedMessage(account, key, username, row, images))
        : presentMessage(row.type, row.content, images, row.imageFileHash)
      return {
        id: row.id, serverId: row.serverId,
        createdAt: row.createTime * 1000,
        messageType: row.type,
        from: mine ? 'me' : 'them',
        senderId: isGroup ? (mine ? account.wxid : row.sender || undefined) : undefined,
        sender: isGroup && !mine ? row.sender || undefined : undefined,
        ...presentation,
        ...(!firstConversation && presentation.image ? { image: { hashes: presentation.image.hashes } } : {}),
        time: clock(row.createTime),
      }
    })
    const first = rows[0]
    const last = rows[rows.length - 1]

    conversations.push({
      id: username,
      name: session.nickname && session.nickname !== username ? session.nickname : isGroup ? '未命名群聊' : '未命名联系人',
      type: conversationType(username),
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
    if (conversation.type === 'friend' && conversationProfile?.isVerifiedAccount) conversation.type = 'official'
    if (conversationProfile?.nickname && conversationProfile.nickname !== conversation.id) conversation.name = conversationProfile.nickname
    conversation.avatar = conversationProfile?.avatar
    const groupNames = conversation.type === 'group' ? client.getGroupNicknames(conversation.id) : new Map<string, string>()
    for (const message of conversation.messages) {
      const senderId = message.senderId ?? message.sender
      if (!senderId) continue
      const senderProfile = profiles.get(senderId)
      message.avatar = senderProfile?.avatar
      const senderName = groupNames.get(senderId) || senderProfile?.nickname
      message.sender = senderName && senderName !== senderId ? senderName : message.from === 'me' ? undefined : '未知成员'
    }
  }

  let monitorWarning: string | undefined
  if (indexDirectory) {
    const directory = join(indexDirectory, '..', 'group-monitor')
    monitorWarning = updateMonitorForSync(directory, account.root, key, state => {
      state.rooms = state.rooms.filter(room => conversationCacheAllowed(account.root, room.id))
      recoverCapturedAttachments(state, account.root, key, hash => client.resolveVideoFilename(hash), { budgetMs: 100 })
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
    if (index?.hasConversation(conversationId)) {
      if (query.selectedMessages) {
        selectedRows = index.selectedReportMessages(conversationId, query.selectedMessages)
        for (const row of selectedRows) counts[reportContentType(row.type)]++
        const found = new Set(selectedRows.map(row => reportSelectionKey({ id: row.id, createdAt: row.createTime * 1000 })))
        indexed = query.selectedMessages.every(item => found.has(reportSelectionKey({ id: item.id, createdAt: item.createdAt })))
      } else {
        const content = index.reportContent(conversationId, startAt, endAt, query.contentTypes, query.indexRevision)
        Object.assign(counts, content.counts)
        selectedRows = content.rows.slice()
        indexed = true
      }
    }
  } catch (error) {
    // A changed selection must still be confirmed by the user. Index locks,
    // incomplete stores and read failures can safely use the original records.
    if (error instanceof Error && error.message === '会话索引已更新，请重新选择会话后生成报告') throw error
  } finally { index?.close() }
  if (!indexed) {
    throw new Error('会话索引尚未完成，请在缓存与索引中建立或更新索引后重试')
  }

  if (query.selectedMessages) {
    const selected = new Set(query.selectedMessages.map(item => reportSelectionKey({ id: item.id, createdAt: item.createdAt })))
    const kept = selectedRows.filter(row => selected.has(reportSelectionKey({ id: row.id, createdAt: row.createTime * 1000 })))
    selectedRows = kept
  }
  selectedRows.sort((left, right) => left.createTime - right.createTime)
  const isGroup = conversationId.endsWith('@chatroom')
  const images = query.deferMedia ? new Map<string, string[]>() : localImages(account.root, conversationId, hash => recordsClient(account, key).resolveImagePath(hash))
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
  const indexed = conversationCacheAllowed(account.root, query.conversationId) ? readChatIndex(directory, account, key, index => index.hasConversation(query.conversationId) ? index.speech(query.conversationId, start, end) : undefined) : undefined
  if (!indexed) throw new Error('会话索引尚未完成，请在缓存与索引中建立或更新索引后重试')
  const stats = indexed
  try {
    stats.silentMembers = findSilentMembers(client.getGroupMemberIds(query.conversationId), stats.members)
  } catch (error) {
    stats.membershipError = error instanceof Error ? error.message : '读取群成员失败'
  }
  for (const member of stats.members) member.isSelf = member.id === account.wxid
  const names = client.getDisplayNames([...stats.members, ...(stats.silentMembers ?? [])].map(member => member.id).filter(Boolean))
  const groupNames = client.getGroupNicknames(query.conversationId)
  for (const member of [...stats.members, ...(stats.silentMembers ?? [])]) member.name = groupNames.get(member.id) || names.get(member.id) || member.id || '未知成员'
  stats.silentMembers?.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return stats
}

export function queryWechatConversationSummary(directory: string, account: WechatAccount, key: string, conversationId: string): ConversationIndexSummary {
  const client = recordsClient(account, key)
  const indexed = conversationCacheAllowed(account.root, conversationId) ? readChatIndex(directory, account, key, index => index.hasConversation(conversationId) ? index.summary(conversationId) : undefined) : undefined
  if (!indexed) throw new Error('会话索引尚未完成，请在缓存与索引中建立或更新索引后重试')
  return indexed
}

export function prepareWechatReportMedia(account: WechatAccount, key: string, conversationId: string, message: SyncMessage): SyncMessage {
  const media = message.reportMedia
  if (!media) return message
  if (message.messageType === 34) {
    const voice = recordsClient(account, key).getVoiceData(conversationId, { id: message.id, createTime: Math.floor(message.createdAt / 1000), type: 34, content: media.content, serverId: media.serverId, isSend: message.from === 'me', sender: message.senderId || '' })
    return { ...message, voice }
  }
  if (message.messageType === 3) return { ...message, ...presentMessage(3, media.content, localImages(account.root, conversationId, hash => recordsClient(account, key).resolveImagePath(hash)), media.imageFileHash) }
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
    let patternIds: string[] = []
    let index: ChatIndex | undefined
    try {
      index = chatDirectory ? new ChatIndex(chatDirectory, account.root, key, account.wxid, { readOnly: true }) : undefined
      if (index?.hasConversation(query.conversationId)) {
        const candidate = query.patternMetadata ? { revision: index.revision(query.conversationId), summary: index.summary(query.conversationId), rows: index.patternMetadata(query.conversationId, start, end) } : index.reportSelection(query.conversationId, start, end)
        selection = candidate
        if (query.patternMetadata) patternIds = index.patternMemberIds(query.conversationId)
      }
    } catch { /* Report metadata requires a ready index. */ }
    finally { index?.close() }
    if (!selection) throw new Error('会话索引尚未完成，请在缓存与索引中建立或更新索引后重试')
    const rows = selection.rows
    const client = recordsClient(account, key)
    let groupMembers: string[] = []
    if (query.patternMetadata && query.conversationId.endsWith('@chatroom')) {
      try { groupMembers = client.getGroupMemberIds(query.conversationId) } catch { /* Indexed historical members remain selectable when the roster is unavailable. */ }
    }
    const ids = [...new Set([...rows.map(row => row.sender), ...patternIds, ...groupMembers].filter(Boolean))]
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
    return { ...query, counts, messages, patternMembers: query.patternMetadata ? ids.map(id => [id === account.wxid ? 'self' : `id:${id}`, groupNames.get(id)?.trim() || (names.get(id) !== id ? names.get(id)?.trim() : '') || (id === account.wxid ? '我' : '未知成员')] as [string, string]) : undefined, indexRevision: selection.revision }
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

export function readOriginalImage(directory: string, account: WechatAccount, key: string, query: import('../shared/types').OriginalImageQuery): NonNullable<SyncMessage['image']> {
  const allowed = conversationCacheAllowed(account.root, query.conversationId)
  const monitorDirectory = join(directory, '..', 'group-monitor')
  const state = allowed ? loadMonitor(monitorDirectory, account.root, key) : { rooms: [], events: [] }
  const room = state.rooms.find(room => room.id === query.conversationId)
  const originals = room?.messages.filter(message => ((message.type >>> 0) === 3 || Boolean(message.media?.image)) && (message.id === query.messageId || message.revokeNoticeId === query.messageId)) || []
  if (originals.length > 1) throw new Error('无法唯一定位原图片')
  const original = originals[0]
  let image = original?.media?.image
  const client = recordsClient(account, key)
  if (!image?.hashes?.length && !(image?.source && image.thumbnail === false)) {
    const at = original?.at ?? query.createdAt
    const rows = allowed ? readChatIndex(directory, account, key, index => index.messages(query.conversationId, 0, at + 1, 200)) : undefined
    const matches = (row: WcdbMessage): boolean => row.id === (original?.id || query.messageId) && row.createTime * 1000 === at && (row.type >>> 0) === 3
    const row = rows?.find(matches) || client.getMessages(query.conversationId, 200).find(matches)
    if (row) image = presentMessage(3, row.content, localImages(account.root, query.conversationId, hash => client.resolveImagePath(hash)), row.imageFileHash).image
  }
  if (!image) throw new Error('撤回前未保存原图定位信息，无法补取原图')
  const refreshed = refreshOriginalImage(account.root, key, query.conversationId, image, hash => client.resolveImagePath(hash))
  if (original && allowed && refreshed.source && refreshed.thumbnail === false) {
    original.media = { ...original.media, image: refreshed }
    saveMonitor(monitorDirectory, account.root, key, state)
  }
  return refreshed
}

export function readIndexedConversation(directory: string, account: WechatAccount, key: string, conversationId: string, at?: number, limit = MESSAGE_PAGE_SIZE, refresh = false): SyncConversation {
  const client = recordsClient(account, key)
  const indexed = !refresh && conversationCacheAllowed(account.root, conversationId) ? readChatIndex(directory, account, key, index => index.hasConversation(conversationId)
    ? { rows: index.messages(conversationId, 0, at === undefined ? undefined : at + 1, limit), summary: index.summary(conversationId) } : undefined) : undefined
  if (!indexed && at !== undefined) throw new Error('该会话索引尚未完成')
  const rows = indexed ? indexed.rows : client.getMessages(conversationId, limit)
  const profiles = client.getProfiles([conversationId, account.wxid, ...rows.map(row => row.sender)])
  const groupNames = conversationId.endsWith('@chatroom') ? client.getGroupNicknames(conversationId) : new Map<string, string>()
  const images = localImages(account.root, conversationId, hash => recordsClient(account, key).resolveImagePath(hash))
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
    type: conversationType(conversationId, profiles.get(conversationId)?.isVerifiedAccount),
    time: rows.length ? clock(rows[rows.length - 1].createTime) : '', preview: messages[messages.length - 1]?.text || '',
    records: summary.total.toLocaleString('en-US'), range: summary.firstAt === null ? '' : `${monthLabel(summary.firstAt / 1000)} — ${monthLabel(summary.lastAt! / 1000)}`,
    day: rows.length ? dayLabel(rows[rows.length - 1].createTime) : '', messages: conversationCacheAllowed(account.root, conversationId) ? retainedRecallMessages(messages, loadMonitor(join(directory, '..', 'group-monitor'), account.root, key).rooms.find(room => room.id === conversationId)) : messages }
}

export function loadReportParticipantProfiles(account: WechatAccount, key: string, participants: ReportParticipant[]): ReportParticipant[] {
  const top = participants.slice(0, 5).map(member => ({ ...member, id: member.id || (member.key === 'self' ? account.wxid : undefined) }))
  const profiles = recordsClient(account, key).getProfiles(top.flatMap(member => member.id ? [member.id] : []))
  return top.map(member => ({ ...member, name: member.name && member.name !== '我' ? member.name : (member.id ? profiles.get(member.id)?.nickname || member.id : '未知成员'), avatar: member.id ? profiles.get(member.id)?.avatar || member.avatar : member.avatar }))
}

export function readWechatProfileEvidence(directory: string, account: WechatAccount, key: string, conversationId: string, memberId: string, query: ProfilePageQuery): ProfileMessagePage {
  if (!conversationCacheAllowed(account.root, conversationId)) throw new Error('该会话已排除索引，无法生成画像')
  const page = readChatIndex(directory, account, key, index => index.hasConversation(conversationId)
    ? index.profileMessagePage(conversationId, memberId, query) : undefined)
  if (!page) throw new Error('请先在「缓存与索引」中建立该会话的索引')

  const speakers = new Map<string, number>()
  const textMessage = (row: WcdbMessage, sender: string): ProfileMessage => {
    const target = sender === memberId || (!sender && !row.isSend && !conversationId.endsWith('@chatroom'))
    if (!target && !speakers.has(sender)) speakers.set(sender, speakers.size + 1)
    return {
      id: row.id, createdAt: row.createTime * 1000, target,
      speaker: target ? 0 : speakers.get(sender)!,
      text: row.content,
    }
  }
  const withQuote = (message: ProfileMessage, quotedText?: string): ProfileMessage[] =>
    quotedText ? [{
      id: `${message.id}:quote`, createdAt: message.createdAt,
      target: false, speaker: -1, text: `引用内容：${quotedText}`,
    }, message] : [message]
  const nearbyMessage = (item: { message: WcdbMessage; sender: string; quotedText?: string }) =>
    withQuote(textMessage(item.message, item.sender), item.quotedText)
  const clips = page.rows.map(window => {
    const anchor = textMessage(window.anchor, memberId)
    const messages = [
      ...window.previous.flatMap(nearbyMessage),
      ...withQuote(anchor, window.quotedText),
      ...window.following.flatMap(nearbyMessage),
    ].filter(message => message.text)
    return { anchor, messages, serverId: window.anchor.serverId, cursor: window.cursor }
  })
  return { snapshot: page.snapshot, next: page.next, clips }
}

export function loadWechatProfileAvatars(account: WechatAccount, key: string, userIds: string[]): ProfileAvatar[] {
  const profiles = recordsClient(account, key).getProfiles(userIds)
  return [...profiles].flatMap(([id, { avatar }]) => {
    if (!avatar) return []
    const source = avatar.replace(/^http:\/\/(?=(?:[a-z\d-]+\.)*(?:qlogo|qpic)\.cn\/)/i, 'https://')
    return [{ id, avatar: source }]
  })
}

export function listWechatGroupMembers(account: WechatAccount, key: string, conversationId: string): import('../shared/types').GroupMember[] {
  const client = recordsClient(account, key)
  const ids = client.getGroupMemberIds(conversationId)
  const nicknames = client.getGroupNicknames(conversationId)
  const names = client.getDisplayNames(ids.filter(id => !nicknames.get(id)))
  return ids.map(id => {
    const name = nicknames.get(id) || names.get(id)
    return { id, name: name && name !== id ? name : '未命名群成员' }
  }).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id))
}

export function listWechatConversationOptions(account: WechatAccount, key: string, textOnly = false): import('../shared/types').ConversationOption[] {
  const client = recordsClient(account, key)
  const sessions = client.getSessions().filter(item => item.username && item.username !== 'filehelper').sort((a, b) => b.lastActive - a.lastActive)
  const names = textOnly ? client.getPersonalContactNames(sessions.filter(item => !item.username.endsWith('@chatroom') && item.username !== account.wxid).map(item => item.username)) : undefined
  const groupNames = textOnly ? client.getDisplayNames(sessions
    .filter(item => item.username.endsWith('@chatroom') && (!item.nickname || item.nickname === item.username))
    .map(item => item.username)) : undefined
  const profiles = textOnly ? undefined : client.getProfiles(sessions.map(item => item.username))
  return sessions.filter(item => !names || item.username.endsWith('@chatroom') || names.has(item.username)).map(item => ({
    id: item.username,
    name: [profiles?.get(item.username)?.nickname, item.nickname, names?.get(item.username), groupNames?.get(item.username)].find(name => name && name !== item.username)
      || (item.username.endsWith('@chatroom') ? '未命名群聊' : '未命名联系人'),
    avatar: profiles?.get(item.username)?.avatar,
    type: conversationType(item.username, profiles?.get(item.username)?.isVerifiedAccount),
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

export function exportWechatConversation(account: WechatAccount, key: string, query: ChatExportQuery) {
  const { conversationId, scope, format } = query
  const client = recordsClient(account, key)
  const isGroup = conversationId.endsWith('@chatroom')
  const source = client.indexSource()
  const rows: WcdbMessage[] = []
  for (const store of source.stores().filter(store => store.room === conversationId)) {
    const { maxId, count } = source.watermark(store)
    let after = 0
    let read = 0
    while (after < maxId) {
      const page = source.page(store, after, maxId, 500)
      const next = Math.max(...page.map(row => Number(row.id)))
      if (!Number.isSafeInteger(next) || next <= after) throw new Error('读取期间聊天记录发生变化，请重试')
      rows.push(...page)
      read += page.length
      after = next
    }
    if (read !== count) throw new Error('读取期间聊天记录发生变化，请重试')
  }
  rows.sort((a, b) => a.createTime - b.createTime)
  const isMine = (row: WcdbMessage) => row.isSend || row.sender === account.wxid
  const senderId = (row: WcdbMessage) => isMine(row) ? account.wxid : isGroup ? row.sender : conversationId
  const selected = rows.filter(row => {
    switch (scope.kind) {
      case 'all': return true
      case 'me': return isMine(row)
      case 'peer': return !isMine(row)
      case 'member': return senderId(row) === scope.id
    }
  })
  const groupNames = isGroup ? client.getGroupNicknames(conversationId) : new Map<string, string>()
  const names = client.getDisplayNames([...new Set(selected.map(senderId).filter(Boolean))])
  const ids = new Map<string, number | undefined>()
  selected.forEach((row, index) => {
    if (row.serverId && row.serverId !== '0') ids.set(row.serverId, ids.has(row.serverId) ? undefined : index + 1)
  })
  const noImages = new Map<string, string[]>()
  const records = selected.map((row, index) => {
    const id = senderId(row)
    const name = groupNames.get(id) || names.get(id)
    const { text, quote } = presentMessage(row.type, row.content, noImages)
    return {
      id: index + 1,
      time: new Date(row.createTime * 1000).toISOString(),
      sender: name && name !== id ? name : isMine(row) ? '我方' : isGroup ? '未知成员' : '对方',
      type: row.type,
      text,
      quote: quote && { sender: quote.sender, text: quote.text, replyTo: ids.get(quote.messageId ?? '') },
    }
  })
  return { content: serializeChatExport(records, format), count: records.length }
}
