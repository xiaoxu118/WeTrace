export interface ChatIndexStatus {
  state: 'idle' | 'building' | 'paused' | 'ready' | 'error'
  messages: number
  conversations: number
  completedStores: number
  totalStores: number
  current: string
  updatedAt: string | null
  excludedConversationIds?: string[]
  errors: string[]
}
export type ChatIndexAction = 'start' | 'sync' | 'pause' | 'rebuild' | 'status' | 'exclusions'
export interface ChatIndexQuery { root?: string; action: ChatIndexAction; excludedConversationIds?: string[] }
export type ChatIndexResponse = { ok: true; data: ChatIndexStatus } | { ok: false; error: string }
export interface ChatIndexSearchQuery { root?: string; keyword: string }
export interface ChatIndexSearchMatch { conversationId: string; conversationName: string; id: string; createdAt: number; text: string }
export type ChatIndexSearchResponse = { ok: true; matches: ChatIndexSearchMatch[] } | { ok: false; error: string }
export interface IndexedConversationQuery { root?: string; conversationId: string; at?: number; limit?: number; refresh?: boolean }
export type IndexedConversationResponse = { ok: true; conversation: import('./types').SyncConversation } | { ok: false; error: string }
