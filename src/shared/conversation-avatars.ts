import type { SyncConversation } from './types'

// The caller supplies conversations from the same account only.
export function preserveConversationAvatars(incoming: SyncConversation, previous?: SyncConversation): SyncConversation {
  if (!previous || previous.id !== incoming.id) return incoming
  const avatars = new Map<string, string>()
  const senderKey = (message: SyncConversation['messages'][number]): string | undefined =>
    message.from === 'me' ? 'self' : message.senderId ? `sender:${message.senderId}` : incoming.type !== 'group' ? 'contact' : undefined
  for (const message of [...previous.messages, ...incoming.messages]) {
    const key = senderKey(message)
    if (key && message.avatar && !message.revoke && !message.recall && ![10000, 10002].includes(message.messageType >>> 0)) avatars.set(key, message.avatar)
  }
  return { ...incoming, avatar: incoming.avatar || previous.avatar,
    messages: incoming.messages.map(message => {
      if (message.avatar) return message
      const key = senderKey(message)
      const avatar = key && avatars.get(key)
      return avatar ? { ...message, avatar } : message
    }) }
}
