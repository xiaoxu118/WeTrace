export interface ChatIndexStatus {
  state: 'idle' | 'building' | 'paused' | 'ready' | 'error'
  messages: number
  conversations: number
  completedStores: number
  totalStores: number
  current: string
  phase?: 'discovering' | 'checking' | 'reading' | 'publishing'
  currentMessages?: number
  currentTotal?: number
  updatedAt: string | null
  excludedConversationIds?: string[]
  errors: string[]
}
export type ChatIndexAction = 'start' | 'sync' | 'pause' | 'rebuild' | 'status' | 'exclusions'

export function chatIndexErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/database(?: table)? is locked|SQLITE_(?:BUSY|LOCKED)/i.test(message)) return '本地索引正被其他任务占用，请重新更新索引'
  return message
}
export interface ChatIndexQuery { root?: string; action: ChatIndexAction; excludedConversationIds?: string[] }
export type ChatIndexResponse = { ok: true; data: ChatIndexStatus } | { ok: false; error: string }
export interface ChatIndexSearchQuery { root?: string; keyword: string }
export interface ChatIndexSearchMatch { conversationId: string; conversationName: string; id: string; createdAt: number; text: string }
export type ChatIndexSearchResponse = { ok: true; matches: ChatIndexSearchMatch[] } | { ok: false; error: string }
export interface IndexedConversationQuery { root?: string; conversationId: string; at?: number; limit?: number; refresh?: boolean }
export type IndexedConversationResponse = { ok: true; conversation: import('./types').SyncConversation } | { ok: false; error: string }
