import type { AiQueryState } from './ai-chat'
import type { SyncMessage } from './types'
export interface AiEvidenceQuery { root: string; state: AiQueryState; keyword: string; page: number }
export interface AiEvidencePage { messages: SyncMessage[]; total: number }
export type AiEvidenceResponse = { ok: true; data: AiEvidencePage } | { ok: false; error: string }
