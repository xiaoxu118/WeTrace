import type { ReportParticipant } from './report-facts'
import type { ChatIndexSearchMatch, ChatIndexAction, ChatIndexStatus } from './chat-index'
import type { SyncConversation, SyncMessage, ConversationIndexQuery, ConversationIndexSummary, SpeechStatsQuery, SpeechStatsResult, ReportMessagesFilter, ReportMessagesResult, SyncResult, WechatAccount } from './types'

export type RecordsCommand =
  | { type: 'init'; paths: { appPath: string; resourcesPath: string; statsPath: string } }
  | { type: 'index-search'; id: number; account: WechatAccount; key: string; keyword: string }
  | { type: 'index-conversation'; id: number; account: WechatAccount; key: string; conversationId: string; at?: number; limit?: number; refresh?: boolean }
  | { type: 'chat-index'; id: number; account: WechatAccount; key: string; action: ChatIndexAction; excludedConversationIds?: string[] }
  | { type: 'conversation-options'; id: number; account: WechatAccount; key: string }
  | { type: 'group-monitor'; id: number; account: WechatAccount; key: string; query: import('./group-monitor').MonitorQuery }
  | { type: 'sync'; id: number; account: WechatAccount; key: string }
  | { type: 'report-participants'; id: number; account: WechatAccount; key: string; participants: ReportParticipant[] }
  | { type: 'report-media'; id: number; account: WechatAccount; key: string; conversationId: string; message: SyncMessage }
  | { type: 'report'; id: number; account: WechatAccount; key: string; query: ReportMessagesFilter }
  | { type: 'conversation-summary'; id: number; account: WechatAccount; key: string; query: ConversationIndexQuery }
  | { type: 'speech'; id: number; account: WechatAccount; key: string; query: SpeechStatsQuery }
  | { type: 'validate'; id: number; root: string; key: string }
  | { type: 'sticker-url'; id: number; account: WechatAccount; key: string; md5: string }
  | { type: 'image'; id: number; imageId: string }

export type PreviewData = { id: string; data: Uint8Array; mime: string }
export type RecordsEvent =
  | { type: 'preview'; preview: PreviewData }
  | { type: 'result'; id: number; result?: string | import('./group-monitor').MonitorState | import('./types').ConversationOption[] | ReportParticipant[] | ChatIndexSearchMatch[] | SyncConversation | ChatIndexStatus | SyncMessage | ConversationIndexSummary | SpeechStatsResult | SyncResult | ReportMessagesResult | PreviewData | null; error?: string }
