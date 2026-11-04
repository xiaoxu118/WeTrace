export interface WechatAccount {
  id: string
  wxid: string
  root: string
  nickname?: string
  avatar?: string
}

export interface DetectResult {
  account: WechatAccount | null
  hasKey: boolean
  keyCreatedAt: string | null
  error?: string
}

export interface SyncMessage {
  id: string
  serverId?: string
  revoke?: { targetId?: string; unresolvedReason?: 'unlinked' | 'no-capture' | 'retention-limit' | 'capture-gap' }
  createdAt: number
  count?: number
  messageType: number
  from: 'me' | 'them'
  sender?: string
  senderId?: string
  avatar?: string
  text: string
  recall?: { original: string; originalAt: number; media?: Pick<SyncMessage, 'image' | 'voice' | 'sticker' | 'link' | 'forwarded' | 'quote'> }
  reportMedia?: { content: string; serverId?: string; imageFileHash?: string }
  voice?: { hex?: string; unavailable?: string }
  image?: { source?: string; unavailable?: string; thumbnail?: boolean }
  sticker?: { source?: string; unavailable?: string; label: string; md5?: string; cdnUrl?: string }
  link?: { url: string; title: string; description?: string }
  forwarded?: { title: string; entries: { sender: string; time?: string; text: string; messageType?: number }[]; unavailable?: string }
  quote?: { sender: string; text: string; type?: number; messageId?: string }
  time: string
}

export interface SyncConversation {
  id: string
  name: string
  avatar?: string
  type: 'friend' | 'group' | 'official'
  memberCount?: number
  time: string
  preview: string
  unread?: number
  records: string
  range: string
  day: string
  messages: SyncMessage[]
}

export interface SyncResult {
  monitorWarning?: string
  account: WechatAccount
  conversations: SyncConversation[]
  messageTotal: number
  syncedAt: string
}

export type SyncResponse = { ok: true; data: SyncResult } | { ok: false; error: string }

export type ReportContentType = 'message' | 'voice' | 'image' | 'video'

export interface ReportMessageSelection { id: string; createdAt: number; entryIndex?: number }

export interface ReportMessagesFilter {
  selectedMessages?: ReportMessageSelection[]
  conversationId: string
  startDate: string
  endDate: string
  contentTypes: ReportContentType[]
  includeVoiceData?: boolean
  deferMedia?: boolean
  metadataOnly?: boolean
  indexRevision?: string
}

export interface ReportMessagesQuery extends ReportMessagesFilter {
  root?: string
}

export interface ReportMessagesResult extends ReportMessagesFilter {
  selectionOnly?: boolean
  messages: SyncMessage[]
  counts: Record<ReportContentType, number>
}

export type ReportMessagesResponse = { ok: true; data: ReportMessagesResult } | { ok: false; error: string }

export interface KeyStatus {
  supported?: boolean
  error?: string
  sipEnabled: boolean
  hasKey: boolean
  wechatRunning: boolean
  wechatLoggedIn: boolean
}

export type FetchKeyResponse = { ok: true } | { ok: false; error: string }

export type ModelKind = 'text' | 'image' | 'speech'
export type ApiFormat = 'openai' | 'anthropic'
export type ModelSource = 'remote' | 'local'

export interface ModelConfig {
  kind: ModelKind
  source: ModelSource
  apiFormat: ApiFormat
  id: string
  name: string
  isDefault: boolean
  provider: string
  baseUrl: string
  model: string
  localPath: string
  hasApiKey: boolean
}

export interface SaveModelConfigInput {
  kind?: ModelKind
  source?: ModelSource
  apiFormat?: ApiFormat
  id?: string
  name: string
  provider: string
  baseUrl: string
  model: string
  localPath?: string
  apiKey?: string
}

export type VoiceModelState = 'missing' | 'downloading' | 'ready' | 'invalid' | 'error' | 'unsupported'

export interface VoiceModelStatus {
  modelId: string
  version: string
  directory: string
  state: VoiceModelState
  downloadedBytes: number
  totalBytes: number
  progress: number
  platform: string
  architecture: string
  supported: boolean
  error?: string
}

export interface VoiceModelDownloadResult {
  success: boolean
  status: VoiceModelStatus
  error?: string
}

export interface ReportConversationQuery { root?: string; conversationId: string; selectedMessages?: ReportMessageSelection[] }
export interface ReportConversationSnapshot { snapshotId: string; conversationId: string; messages: SyncMessage[] }
export type ReportConversationResponse = { ok: true; data: ReportConversationSnapshot } | { ok: false; error: string }

export interface GenerateReportInput extends ReportMessagesQuery {
  targetMember?: { key: string; name: string }
  snapshotId: string
  requestId: string
  conversationName: string
  modelId: string
  imageModelId?: string
  imageConcurrency?: number
  templateId: string
  style: string
  format: 'mobile' | 'desktop'
}
export type ReportStage = 'read' | 'voice' | 'image' | 'summarize' | 'export' | 'done' | 'error'
export interface ReportMediaProgress { total: number; processed: number; succeeded: number; failed: number; cached: number }
export interface ReportProgress {
  failedStage?: ReportStage
  failedStep?: string
  advice?: string
  diagnosticPath?: string
  requestId: string
  stage: ReportStage
  media?: { voice: ReportMediaProgress; image: ReportMediaProgress }
  percent: number
  detail: string
}
export interface GeneratedReport { htmlPath: string; pngPaths: string[]; content: string; warnings: string[] }
export type GenerateReportResponse = { ok: true; data: GeneratedReport } | { ok: false; error: string; advice?: string; diagnosticPath?: string }

export interface SpeechStatsQuery { root?: string; conversationId: string; startDate: string; endDate: string }
export interface SpeechStatsResult {
  total: number
  members: { id: string; name: string; count: number; isSelf?: boolean }[]
  silentMembers: { id: string; name: string }[] | null
  membershipError?: string
}
export type SpeechStatsResponse = { ok: true; data: SpeechStatsResult } | { ok: false; error: string }

export interface ConversationIndexQuery { root?: string; conversationId: string }
export interface ConversationIndexSummary { total: number; firstAt: number | null; lastAt: number | null }
export type ConversationIndexResponse = { ok: true; data: ConversationIndexSummary } | { ok: false; error: string }

export interface ReportHistoryItem { styleId?: string; styleName?: string; id: string; name: string; startDate: string; endDate: string; createdAt: number; htmlPath: string; pngPaths: string[] }

export type ConversationOption = Pick<SyncConversation, 'id' | 'name' | 'type' | 'avatar'>
export type ConversationOptionsResponse = { ok: true; conversations: ConversationOption[] } | { ok: false; error: string }

export interface VoiceMessageQuery { root?: string; conversationId: string; id: string; createdAt: number }
export type VoiceMessageResponse = { ok: true; text: string; warning?: string } | { ok: false; error: string }
