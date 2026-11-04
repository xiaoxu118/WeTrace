export interface AiConversationMemory {
  version: 1
  scope: string
  summary: string
  coveredTurns: number
  prefixHash: string
}
export interface AiQueryState {
  conversationId: string
  startDate: string
  endDate: string
  timeRange?: 'dates' | 'all'
  speaker?: string
  analysisMode?: 'messages' | 'interaction'
  analysisType?: 'general' | 'profile'
  profileMemberIsSelf?: boolean
  profileMemberId?: string
  profileTarget?: string
  profileDisplayName?: string
}
export interface AiChatTurn { role: 'user' | 'assistant'; content: string; createdAt?: number; queryState?: AiQueryState }
export interface AiChatContext {
  conversationId: string
  conversationName: string
}
export interface AiConversationLaunch { id: string; root: string; context: AiChatContext }
export interface AiProfileRequest {
  conversationId: string
  targetName: string
  memberId?: string
  isSelf?: boolean
  timeRange: 'all' | 'dates'
  startDate: string
  endDate: string
}
export interface AiChatInput {
  profile?: AiProfileRequest
  chatId?: string
  requestId: string
  root: string
  modelId: string
  conversations: { id: string; name: string }[]
  context?: AiChatContext
  turns: AiChatTurn[]
  memory?: AiConversationMemory
}
export type AiChatResponse = { ok: true; answer: string; queryState?: AiQueryState; memory?: AiConversationMemory } | { ok: false; error: string }

export interface AiChatDelta { requestId: string; text: string }

export interface AiChatProgress { requestId: string; detail: string }
