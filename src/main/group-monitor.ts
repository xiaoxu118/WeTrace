import { parseRevokeMessage } from '../shared/revoke-message.ts'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { MonitorEvent, MonitorMessage, MonitorRoom, MonitorState } from '../shared/group-monitor'

export const emptyMonitor = (): MonitorState => ({ rooms: [], events: [] })
const isRevoke = (message: MonitorMessage): boolean => Boolean(parseRevokeMessage(message.type, message.text))
export function observeRoom(state: MonitorState, room: MonitorRoom, messages: MonitorMessage[], members: Record<string, string> | undefined, now: number, emitEvents = true): void {
  const emit = (kind: MonitorEvent['kind'], id: string, sender: string, text: string, original?: string): void => {
    if (!emitEvents || kind !== 'revoked' && room.eventKinds && !room.eventKinds.includes(kind)) return
    const eventId = `${room.id}:${kind}:${id}`
    if (!state.events.some(event => event.id === eventId)) state.events.push({ id: eventId, room: room.id, kind, at: now, sender, text, original })
  }
  if (members) {
    if (room.members) {
      for (const [id, name] of Object.entries(room.members)) if (!(id in members)) emit('left', `${now}:${id}`, name, '已不在最新群成员名单中（无法区分主动退群或被移出）')
      for (const [id, name] of Object.entries(members)) if (!(id in room.members)) emit('joined', `${now}:${id}`, name, '出现在最新群成员名单中')
    }
    room.members = members
  }
  for (const message of messages) {
    const old = room.messages.find(item => item.id === message.id)
    if (isRevoke(message)) {
      if (old?.revoked) continue
      const target = parseRevokeMessage(message.type, message.text)?.targetId
      const candidates = room.messages.filter(item => !isRevoke(item) && (target ? item.serverId === target : message.serverId && message.serverId !== '0' && item.serverId === message.serverId))
      const original = old && !isRevoke(old) && (!message.serverId || message.serverId === '0' || !old.serverId || old.serverId === '0' || message.serverId === old.serverId) ? old : candidates.length === 1 ? candidates[0] : undefined
      if (original) { original.revoked = true; original.revokeNoticeId = message.id }
      if ((!old || !isRevoke(old)) && (old || message.at >= room.startedAt)) {
        const notice = parseRevokeMessage(message.type, message.text)?.notice || '一条消息已撤回'
        emit('revoked', message.id, original?.sender || message.sender, notice, original?.text)
      }
      // Keep captured text when WeChat replaces a row with its recall notice.
      if (old && original === old) continue
    } else if (!old && ![10000, 10002].includes(message.type >>> 0) && message.at >= Math.floor(room.startedAt / 1000) * 1000) emit('message', message.id, message.sender, message.text)
    if (!old) room.messages.push({ ...message })
    else if (!isRevoke(message) && !old.revoked) {
      // The send acknowledgement assigns the server ID after the initial local record.
      if (message.serverId && message.serverId !== '0') old.serverId = message.serverId
      if (message.from) old.from = message.from
      if (message.senderId) old.senderId = message.senderId
      if (message.media) old.media = { ...old.media, ...Object.fromEntries(Object.entries(message.media).filter(([, value]) => value !== undefined)) }
    }
  }
  if (room.messages.length > 5000) room.retentionLimited = true
  room.messages = room.messages.slice(-5000)
  let mediaBytes = 0
  for (let index = room.messages.length - 1; index >= 0; index--) {
    const media = room.messages[index].media
    if (!media) continue
    mediaBytes += (media.voice?.hex?.length || 0) + (media.image?.source?.startsWith('data:') ? media.image.source.length : 0)
    if (mediaBytes > 16 * 1024 * 1024) { delete media.voice; if (media.image?.source?.startsWith('data:')) media.image = { unavailable: '媒体已超出本地保留容量' }; room.retentionLimited = true }
  }
  state.events = state.events.slice(-2000)
  room.checkedAt = now
}

export function monitorFile(directory: string, root: string): string { return join(directory, `${createHash('sha256').update(root).digest('hex')}.bin`) }
function encryptionKey(key: string): Buffer { return createHash('sha256').update('wetrace-group-monitor-v1\0').update(key).digest() }
export function loadMonitor(directory: string, root: string, key: string): MonitorState {
  const file = monitorFile(directory, root)
  if (!existsSync(file)) return emptyMonitor()
  const data = readFileSync(file)
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(key), data.subarray(0, 12))
  cipher.setAuthTag(data.subarray(12, 28))
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8'))
}
export function saveMonitor(directory: string, root: string, key: string, state: MonitorState): void {
  // Bound retained binary snapshots per account, independently of the message-count cap.
  let accountMediaBytes = 0
  for (const room of [...state.rooms].sort((left, right) => (right.checkedAt || right.startedAt) - (left.checkedAt || left.startedAt))) {
    for (let index = room.messages.length - 1; index >= 0; index--) {
      const media = room.messages[index].media
      if (!media) continue
      accountMediaBytes += (media.voice?.hex?.length || 0) + (media.image?.source?.startsWith('data:') ? media.image.source.length : 0)
      if (accountMediaBytes > 64 * 1024 * 1024) { delete media.voice; if (media.image?.source?.startsWith('data:')) media.image = { unavailable: '媒体已超出账号保留容量' }; room.retentionLimited = true }
    }
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(key), iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()])
  const file = monitorFile(directory, root)
  // Multiple application/records processes may persist the same account simultaneously.
  // A shared .tmp can be renamed away by another writer between write and rename.
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, Buffer.concat([iv, cipher.getAuthTag(), body]), { mode: 0o600, flag: 'wx' })
    renameSync(temporary, file)
  } finally { rmSync(temporary, { force: true }) }
}

/** Optional monitor persistence must never block a successfully read conversation list. */
export function updateMonitorForSync(directory: string, root: string, key: string, update: (state: MonitorState) => void): string | undefined {
  try {
    const state = loadMonitor(directory, root, key)
    update(state)
    saveMonitor(directory, root, key, state)
    return undefined
  } catch {
    return '群监控与撤回原文缓存暂不可用，聊天记录已正常读取；请稍后刷新重试。'
  }
}
