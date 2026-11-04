import type { AiChatContext, AiChatTurn, AiConversationMemory } from './ai-chat'

export interface StoredAiChat {
  id: string
  title: string
  turns: AiChatTurn[]
  context?: AiChatContext
  memory?: AiConversationMemory
  updatedAt: number
  pending?: boolean
}
export interface AiChatArchive { chats: StoredAiChat[]; activeId: string | null }
export interface LoadAiChatHistoryInput { root: string; legacy?: AiChatArchive }
export interface SaveAiChatHistoryInput { root: string; archive: AiChatArchive; revision: number }
export type AiChatHistoryResponse = { ok: true; archive: AiChatArchive; revision: number; warning?: string } | { ok: false; error: string }
export type SaveAiChatHistoryResponse = { ok: true; revision: number } | { ok: false; error: string }
