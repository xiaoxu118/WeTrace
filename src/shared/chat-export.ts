import type { ConversationIndexQuery } from './types'

export type ChatExportScope = { kind: 'all' | 'me' | 'peer' } | { kind: 'member'; id: string }
export interface ChatExportQuery extends ConversationIndexQuery {
  scope: ChatExportScope
  format: 'csv' | 'json'
}
export type ChatExportResponse =
  | { ok: true; canceled: true }
  | { ok: true; canceled: false; count: number }
  | { ok: false; error: string }
