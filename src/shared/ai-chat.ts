export interface AiChatTurn { role: 'user' | 'assistant'; content: string }
export interface AiChatContext {
  conversationId: string
  conversationName: string
}
export interface AiConversationLaunch { id: string; root: string; context: AiChatContext }
export interface AiChatInput {
  requestId: string
  root: string
  modelId: string
  conversations: { id: string; name: string }[]
  context?: AiChatContext
  turns: AiChatTurn[]
}
export type AiChatResponse = { ok: true; answer: string } | { ok: false; error: string }

export interface AiChatDelta { requestId: string; text: string }

export interface AiChatProgress { requestId: string; detail: string }
