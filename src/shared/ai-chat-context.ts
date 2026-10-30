import type { SyncConversation } from './types'
import type { AiChatContext } from './ai-chat'

// Only associate the conversation; retrieve messages after the user asks a question.
export function conversationAiContext(conversation: Pick<SyncConversation, 'id' | 'name'>): AiChatContext {
  return { conversationId: conversation.id, conversationName: conversation.name }
}
