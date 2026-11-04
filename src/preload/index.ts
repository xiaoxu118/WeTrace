import type { ChatIndexSearchQuery, ChatIndexSearchResponse, IndexedConversationQuery, IndexedConversationResponse, ChatIndexQuery, ChatIndexResponse } from '../shared/chat-index'
import type { ConversationIndexQuery, ConversationIndexResponse, SpeechStatsQuery, SpeechStatsResponse } from '../shared/types'
import type { ReportWritingStyle, SaveReportStyleInput } from '../shared/report-styles'
import { contextBridge, ipcRenderer } from 'electron'
import type { ReportConversationQuery, ReportConversationResponse, GenerateReportInput, GenerateReportResponse, ReportProgress, DetectResult, FetchKeyResponse, KeyStatus, ModelConfig, ReportMessagesQuery, ReportMessagesResponse, SaveModelConfigInput, SyncResponse, VoiceModelDownloadResult, VoiceModelStatus, WechatAccount } from '../shared/types'

const api = {
  scheduledMessages: (root: string, action: import('../shared/scheduled-messages').SendTaskAction): Promise<import('../shared/scheduled-messages').SendTaskResponse> => ipcRenderer.invoke('messages:schedule', root, action),
  aiEvidence: (input: import('../shared/ai-evidence').AiEvidenceQuery): Promise<import('../shared/ai-evidence').AiEvidenceResponse> => ipcRenderer.invoke('ai:evidence', input),
  aiMemory: (root: string, action: import('../shared/ai-long-term-memory').AiMemoryAction): Promise<import('../shared/ai-long-term-memory').AiMemoryResponse> => ipcRenderer.invoke('ai:memory', root, action),
  loadAiChatHistory: (input: import('../shared/ai-chat-history').LoadAiChatHistoryInput): Promise<import('../shared/ai-chat-history').AiChatHistoryResponse> => ipcRenderer.invoke('ai:history-load', input),
  saveAiChatHistory: (input: import('../shared/ai-chat-history').SaveAiChatHistoryInput): Promise<import('../shared/ai-chat-history').SaveAiChatHistoryResponse> => ipcRenderer.invoke('ai:history-save', input),
  transcribeVoiceMessage: (query: import('../shared/types').VoiceMessageQuery): Promise<import('../shared/types').VoiceMessageResponse> => ipcRenderer.invoke('wechat:voice-transcribe', query),
  resolveSticker: (query: import('../shared/sticker').StickerQuery): Promise<import('../shared/sticker').StickerResponse> => ipcRenderer.invoke('wechat:sticker', query),
  groupMonitor: (query: import('../shared/group-monitor').MonitorQuery): Promise<import('../shared/group-monitor').MonitorResponse> => ipcRenderer.invoke('wechat:group-monitor', query),
  listConversationOptions: (root?: string): Promise<import('../shared/types').ConversationOptionsResponse> => ipcRenderer.invoke('wechat:conversation-options', root),
  loadAiPrompts: (): Promise<import('../shared/ai-prompt-settings').AiPromptSettingsResponse> => ipcRenderer.invoke('ai:prompts-load'),
  saveAiPrompts: (input: import('../shared/ai-prompt-settings').SaveAiPromptsInput): Promise<import('../shared/ai-prompt-settings').AiPromptSettingsResponse> => ipcRenderer.invoke('ai:prompts-save', input),
  onAiProgress: (callback: (progress: import('../shared/ai-chat').AiChatProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: import('../shared/ai-chat').AiChatProgress) => callback(progress)
    ipcRenderer.on('ai:progress', listener)
    return () => ipcRenderer.removeListener('ai:progress', listener)
  },
  loadAiKnowledge: (): Promise<import('../shared/ai-knowledge').AiKnowledge> => ipcRenderer.invoke('ai:knowledge-load'),
  saveAiKnowledge: (input: import('../shared/ai-knowledge').AiKnowledge): Promise<import('../shared/ai-knowledge').AiKnowledge> => ipcRenderer.invoke('ai:knowledge-save', input),
  refreshAiHotspots: (): Promise<import('../shared/ai-knowledge').HotspotResult> => ipcRenderer.invoke('ai:hotspots-refresh'),
  cancelAi: (requestId: string): Promise<void> => ipcRenderer.invoke('ai:cancel', requestId),
  onAiDelta: (callback: (delta: import('../shared/ai-chat').AiChatDelta) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, delta: import('../shared/ai-chat').AiChatDelta) => callback(delta)
    ipcRenderer.on('ai:delta', listener)
    return () => ipcRenderer.removeListener('ai:delta', listener)
  },
  askAi: (input: import('../shared/ai-chat').AiChatInput): Promise<import('../shared/ai-chat').AiChatResponse> => ipcRenderer.invoke('ai:chat', input),
  getAppInfo: (): Promise<{ version: string; platform: string }> =>
    ipcRenderer.invoke('app:get-info'),
  selectDirectory: (title?: string): Promise<string | null> => ipcRenderer.invoke('dialog:select-directory', title),
  detectWechat: (root?: string): Promise<DetectResult> => ipcRenderer.invoke('wechat:detect', root),
  listWechatAccounts: (root?: string): Promise<WechatAccount[]> => ipcRenderer.invoke('wechat:accounts', root),
  getMediaCacheStats: (): Promise<import('../shared/media-cache').MediaCacheStats> => ipcRenderer.invoke('app:media-cache-stats'),
  getCacheSize: (): Promise<number> => ipcRenderer.invoke('app:cache-size'),
  getKeyStatus: (root?: string): Promise<KeyStatus> =>
    ipcRenderer.invoke('wechat:key-status', root),
  fetchKey: (root?: string): Promise<FetchKeyResponse> =>
    ipcRenderer.invoke('wechat:fetch-key', root),
  onCaptureReady: (callback: () => void): (() => void) => {
    const listener = () => callback()
    ipcRenderer.on('wechat:capture-ready', listener)
    return () => ipcRenderer.removeListener('wechat:capture-ready', listener)
  },
  syncWechat: (root?: string): Promise<SyncResponse> => ipcRenderer.invoke('wechat:sync', root),
  listReportStyles: (): Promise<ReportWritingStyle[]> => ipcRenderer.invoke('report-style:list'),
  saveReportStyle: (input: SaveReportStyleInput): Promise<ReportWritingStyle> => ipcRenderer.invoke('report-style:save', input),
  deleteReportStyle: (id: string): Promise<ReportWritingStyle[]> => ipcRenderer.invoke('report-style:delete', id),
  loadReportConversation: (query: ReportConversationQuery): Promise<ReportConversationResponse> => ipcRenderer.invoke('report:load-conversation', query),
  generateReport: (input: GenerateReportInput): Promise<GenerateReportResponse> => ipcRenderer.invoke('report:generate', input),
  listReports: (): Promise<import('../shared/types').ReportHistoryItem[]> => ipcRenderer.invoke('report:list'),
  revealReport: (file: string): Promise<void> => ipcRenderer.invoke('report:reveal', file),
  openReport: (file: string): Promise<void> => ipcRenderer.invoke('report:open', file),
  onReportProgress: (callback: (progress: ReportProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ReportProgress) => callback(progress)
    ipcRenderer.on('report:progress', listener)
    return () => ipcRenderer.removeListener('report:progress', listener)
  },
  searchChatIndex: (query: ChatIndexSearchQuery): Promise<ChatIndexSearchResponse> => ipcRenderer.invoke('wechat:index-search', query),
  getIndexedConversation: (query: IndexedConversationQuery): Promise<IndexedConversationResponse> => ipcRenderer.invoke('wechat:index-conversation', query),
  controlChatIndex: (query: ChatIndexQuery): Promise<ChatIndexResponse> => ipcRenderer.invoke('wechat:chat-index', query),
  queryConversationSummary: (query: ConversationIndexQuery): Promise<ConversationIndexResponse> => ipcRenderer.invoke('wechat:conversation-summary', query),
  querySpeechStats: (query: SpeechStatsQuery): Promise<SpeechStatsResponse> => ipcRenderer.invoke('wechat:speech-stats', query),
  queryReportMessages: (query: ReportMessagesQuery): Promise<ReportMessagesResponse> => ipcRenderer.invoke('wechat:report-messages', query),
  watchWechatAccount: (root: string): Promise<void> => ipcRenderer.invoke('wechat:watch', root),
  unwatchWechatAccount: (): Promise<void> => ipcRenderer.invoke('wechat:unwatch'),
  onDatabaseChanged: (callback: (root: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, root: string) => callback(root)
    ipcRenderer.on('wechat:database-changed', listener)
    return () => ipcRenderer.removeListener('wechat:database-changed', listener)
  },
  listModelConfigs: (): Promise<ModelConfig[]> => ipcRenderer.invoke('model:list'),
  saveModelConfig: (input: SaveModelConfigInput): Promise<ModelConfig> => ipcRenderer.invoke('model:save', input),
  deleteModelConfig: (id: string): Promise<ModelConfig[]> => ipcRenderer.invoke('model:delete', id),
  setDefaultModelConfig: (id: string): Promise<ModelConfig[]> => ipcRenderer.invoke('model:set-default', id),
  testModelConfig: (input: SaveModelConfigInput): Promise<{ latencyMs: number }> => ipcRenderer.invoke('model:test', input),
  openModelDirectory: (id: string): Promise<void> => ipcRenderer.invoke('model:open-directory', id),
  getVoiceModelStatus: (): Promise<VoiceModelStatus> => ipcRenderer.invoke('voice-model:status'),
  downloadVoiceModel: (): Promise<VoiceModelDownloadResult> => ipcRenderer.invoke('voice-model:download'),
  cancelVoiceModelDownload: (): Promise<boolean> => ipcRenderer.invoke('voice-model:cancel'),
  removeVoiceModel: (): Promise<VoiceModelStatus> => ipcRenderer.invoke('voice-model:remove'),
  openVoiceModelDirectory: (): Promise<void> => ipcRenderer.invoke('voice-model:open-directory'),
  onVoiceModelProgress: (callback: (status: VoiceModelStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: VoiceModelStatus) => callback(status)
    ipcRenderer.on('voice-model:progress', listener)
    return () => ipcRenderer.removeListener('voice-model:progress', listener)
  },
}

contextBridge.exposeInMainWorld('wetrace', api)
