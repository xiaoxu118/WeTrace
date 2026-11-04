import { parseRevokeMessage } from '../shared/revoke-message.ts'
import { observeRoom } from './group-monitor.ts'
import { retainedRecallMessages } from '../shared/retained-recalls.ts'
import type { MonitorState } from '../shared/group-monitor'
import type { SyncConversation } from '../shared/types'

type PreviewReader = (id: string) => { data: Uint8Array; mime: string } | undefined
function captureMedia(message: import('../shared/types').SyncMessage, readPreview?: PreviewReader): import('../shared/group-monitor').MonitorMessage['media'] {
  let image = message.image
  if (image?.source?.startsWith('wetrace-media://preview/') && readPreview) {
    const id = image.source.split('/').at(-1) || ''
    const preview = /^[a-f0-9]{64}$/.test(id) ? readPreview(id) : undefined
    image = preview && /^image\/(png|jpeg|gif|webp)$/.test(preview.mime) && preview.data.length <= 1024 * 1024
      ? { ...image, source: `data:${preview.mime};base64,${Buffer.from(preview.data).toString('base64')}` }
      : { unavailable: preview ? '图片超出本地撤回媒体保留上限' : '未捕获到图片内容' }
  }
  return { image, voice: message.voice?.hex && message.voice.hex.length <= 2 * 1024 * 1024 ? message.voice : undefined, sticker: message.sticker, link: message.link, forwarded: message.forwarded, quote: message.quote }
}

// Called in the records worker, the only writer of the encrypted capture store.
export function captureChatRecalls(state: MonitorState, conversation: SyncConversation, now = Date.now(), readPreview?: PreviewReader): void {
  let room = state.rooms.find(item => item.id === conversation.id)
  if (!room) {
    room = { id: conversation.id, name: conversation.name, enabled: false, startedAt: now, messages: [] }
    state.rooms.push(room)
  }
  const snapshot = { ids: conversation.messages.map(message => message.id), at: now }
  observeRoom(state, room, conversation.messages.map(message => ({
    id: message.id, serverId: message.serverId, at: message.createdAt, type: message.messageType,
    sender: message.sender || (message.from === 'me' ? '我' : conversation.name), senderId: message.senderId, from: message.from,
    media: captureMedia(message, readPreview),
    text: message.revoke?.targetId ? `<revokemsg><newmsgid>${message.revoke.targetId}</newmsgid></revokemsg>` : message.text,
  })), undefined, now, room.enabled)
  room.snapshot = snapshot
  conversation.messages = retainedRecallMessages(conversation.messages, room).map(message => message.revoke && !message.recall
    ? { ...message, revoke: { ...message.revoke, unresolvedReason: room.captureGap ? 'capture-gap' as const : room.retentionLimited ? 'retention-limit' as const : room.messages.some(item => ![10000, 10002].includes(item.type >>> 0)) ? 'unlinked' as const : 'no-capture' as const } }
    : message)
}

/** Preserve explicitly read media without moving the latest-sync capture watermark. */
export function capturePreparedMedia(state: MonitorState, conversationId: string, message: import('../shared/types').SyncMessage, now = Date.now(), readPreview?: PreviewReader): void {
  if (message.revoke || message.recall || [10000, 10002].includes(message.messageType)) return
  let room = state.rooms.find(item => item.id === conversationId)
  if (!room) { room = { id: conversationId, name: conversationId, enabled: false, startedAt: now, messages: [] }; state.rooms.push(room) }
  const checkedAt = room.checkedAt
  observeRoom(state, room, [{ id: message.id, serverId: message.serverId, at: message.createdAt, type: message.messageType, from: message.from, senderId: message.senderId, sender: message.sender || (message.from === 'me' ? '我' : '该成员'), text: message.text,
    media: captureMedia(message, readPreview),
  }], undefined, now, false)
  room.checkedAt = checkedAt
}
