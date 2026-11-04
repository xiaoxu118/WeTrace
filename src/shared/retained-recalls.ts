import { parseRevokeMessage } from './revoke-message.ts'
import type { MonitorRoom } from './group-monitor'
import type { SyncMessage } from './types'

// Join only stable message identifiers. Never guess a recall's original from nearby text.
export function retainedRecallMessages(messages: SyncMessage[], room?: MonitorRoom): SyncMessage[] {
  if (!room) return messages
  const originals = room.messages.filter(message => message.revoked)
  if (!originals.length) return messages
  const byId = new Map(originals.map(message => [message.id, message]))
  const byNotice = new Map(originals.filter(message => message.revokeNoticeId).map(message => [message.revokeNoticeId!, message]))
  // Compatibility with snapshots captured before revokeNoticeId was saved.
  for (const message of room.messages) {
    if (![10000, 10002].includes(message.type)) continue
    const target = parseRevokeMessage(message.type, message.text)?.targetId
    const candidates = target ? originals.filter(item => item.serverId === target) : []
    const original = candidates.length === 1 ? candidates[0] : undefined
    if (original) byNotice.set(message.id, original)
  }
  const visibleIds = new Set(messages.map(message => message.id))
  return messages.flatMap(message => {
    const original = byId.get(message.id) || byNotice.get(message.id)
    if (!original) return [message]
    if (message.id !== original.id && visibleIds.has(original.id)) return []
    return [{ ...message, sender: original.sender, senderId: original.senderId, avatar: message.id === original.id ? message.avatar : undefined,
      from: original.from || (original.sender === '我' ? 'me' as const : message.from),
      recall: { original: original.text, originalAt: original.at, ...(original.media ? { media: original.media } : {}) } }]
  })
}
