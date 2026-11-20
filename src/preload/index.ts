import { personProfileTargetKey } from '../shared/person-profile'
import { personProfileTaskTitle } from '../shared/task-center'
import { aiTaskProgress, cancelProcessingTask, downloadTaskProgress, onProcessingTasks, reportTaskProgress, retryProcessingTask, trackTask } from './task-center'
import { defaultReportTemplates } from '../shared/report-templates'
import type { ChatIndexSearchQuery, ChatIndexSearchResponse, IndexedConversationQuery, IndexedConversationResponse, ChatIndexQuery, ChatIndexResponse } from '../shared/chat-index'
import type { ConversationIndexQuery, ConversationIndexResponse, SpeechStatsQuery, SpeechStatsResponse } from '../shared/types'
import type { ReportWritingStyle, SaveReportStyleInput } from '../shared/report-styles'
import { contextBridge, ipcRenderer } from 'electron'
import type { ReportConversationQuery, ReportConversationResponse, GenerateReportInput, GenerateReportResponse, ReportProgress, DetectResult, FetchKeyResponse, KeyStatus, ModelConfig, ReportMessagesQuery, ReportMessagesResponse, SaveModelConfigInput, SyncResponse, VoiceModelDownloadResult, VoiceModelStatus, WechatAccount } from '../shared/types'

function generatePersonProfile(input: import('../shared/person-profile').GeneratePersonProfileInput): Promise<import('../shared/person-profile').PersonProfileResponse> {
  return trackTask(personProfileTaskTitle, () => ipcRenderer.invoke('profile:generate', input), {
    subject: input.name,
    subjectKey: personProfileTargetKey(input.target),
    progress: aiTaskProgress(input.requestId),
    cancel: () => ipcRenderer.invoke('ai:cancel', input.requestId),
    retry: () => generatePersonProfile({ ...input, requestId: crypto.randomUUID() }),
  })
}

const api = {
  onProcessingTasks,
  retryProcessingTask,
  cancelProcessingTask,
  getOriginalImage: (query: import('../shared/types').OriginalImageQuery): Promise<import('../shared/types').OriginalImageResponse> => ipcRenderer.invoke('wechat:original-image', query),
  saveRetainedFile: (input: import('../shared/types').SaveRetainedFileInput): Promise<import('../shared/types').SaveRetainedFileResponse> => ipcRenderer.invoke('wechat:save-retained-file', input),
  scheduledMessages: (root: string, action: import('../shared/scheduled-messages').SendTaskAction): Promise<import('../shared/scheduled-messages').SendTaskResponse> => ipcRenderer.invoke('messages:schedule', root, action),
  aiEvidence: (input: import('../shared/ai-evidence').AiEvidenceQuery): Promise<import('../shared/ai-evidence').AiEvidenceResponse> => ipcRenderer.invoke('ai:evidence', input),
  aiMemory: (root: string, action: import('../shared/ai-long-term-memory').AiMemoryAction): Promise<import('../shared/ai-long-term-memory').AiMemoryResponse> => ipcRenderer.invoke('ai:memory', root, action),
  loadAiChatHistory: (input: import('../shared/ai-chat-history').LoadAiChatHistoryInput): Promise<import('../shared/ai-chat-history').AiChatHistoryResponse> => ipcRenderer.invoke('ai:history-load', input),
  saveAiChatHistory: (input: import('../shared/ai-chat-history').SaveAiChatHistoryInput): Promise<import('../shared/ai-chat-history').SaveAiChatHistoryResponse> => ipcRenderer.invoke('ai:history-save', input),
  transcribeVoiceMessage: (query: import('../shared/types').VoiceMessageQuery): Promise<import('../shared/types').VoiceMessageResponse> => ipcRenderer.invoke('wechat:voice-transcribe', query),
  resolveSticker: (query: import('../shared/sticker').StickerQuery): Promise<import('../shared/sticker').StickerResponse> => ipcRenderer.invoke('wechat:sticker', query),
  groupMonitor: (query: import('../shared/group-monitor').MonitorQuery): Promise<import('../shared/group-monitor').MonitorResponse> => ipcRenderer.invoke('wechat:group-monitor', query),
  generatePersonProfile,
  onPersonProfileSaved: (callback: (record: import('../shared/person-profile').SavedPersonProfile) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, record: import('../shared/person-profile').SavedPersonProfile) => callback(record)
    ipcRenderer.on('profile:saved', listener)
    return () => ipcRenderer.removeListener('profile:saved', listener)
  },
  listPersonProfiles: (root: string): Promise<import('../shared/person-profile').ListPersonProfilesResponse> => ipcRenderer.invoke('profile:list', root),
  listPersonProfileAvatars: (root: string, userIds: string[]): Promise<import('../shared/person-profile').ProfileAvatar[]> =>
    ipcRenderer.invoke('profile:avatars', root, userIds),
  editPersonProfile: (input: import('../shared/person-profile').EditPersonProfileInput): Promise<import('../shared/person-profile').PersonProfileResponse> => ipcRenderer.invoke('profile:edit', input),
  exportChat: (query: import('../shared/chat-export').ChatExportQuery): Promise<import('../shared/chat-export').ChatExportResponse> => ipcRenderer.invoke('wechat:export-chat', query),
  listGroupMembers: (query: ConversationIndexQuery): Promise<import('../shared/types').GroupMembersResponse> => ipcRenderer.invoke('wechat:group-members', query),
  listConversationOptions: (root?: string, textOnly?: boolean): Promise<import('../shared/types').ConversationOptionsResponse> => ipcRenderer.invoke('wechat:conversation-options', root, textOnly),
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
  askAi: (input: import('../shared/ai-chat').AiChatInput): Promise<import('../shared/ai-chat').AiChatResponse> => trackTask('AI 对话', () => ipcRenderer.invoke('ai:chat', input), { progress: aiTaskProgress(input.requestId) }),
  getAppInfo: (): Promise<{ version: string; platform: string }> =>
    ipcRenderer.invoke('app:get-info'),
  selectDirectory: (title?: string): Promise<string | null> => ipcRenderer.invoke('dialog:select-directory', title),
  detectWechat: (root?: string): Promise<DetectResult> => ipcRenderer.invoke('wechat:detect', root),
  listWechatAccounts: (root?: string): Promise<WechatAccount[]> => ipcRenderer.invoke('wechat:accounts', root),
  getMediaCacheStats: (): Promise<import('../shared/media-cache').MediaCacheStats> => ipcRenderer.invoke('app:media-cache-stats'),
  getCacheSize: (): Promise<number> => ipcRenderer.invoke('app:cache-size'),
  changeCacheDirectory: (): Promise<string | null> => ipcRenderer.invoke('app:change-cache-directory'),
  getCacheDirectory: (): Promise<string> => ipcRenderer.invoke('app:cache-directory'),
  openCacheDirectory: (): Promise<void> => ipcRenderer.invoke('app:open-cache-directory'),
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
  generateReport: (input: GenerateReportInput): Promise<GenerateReportResponse> => trackTask(defaultReportTemplates.find(template => template.id === input.templateId)?.layout === 'daily' ? '日报生成' : '报告生成', () => ipcRenderer.invoke('report:generate', input), { subject: input.conversationName, progress: reportTaskProgress(input.requestId) }),
  listReports: (): Promise<import('../shared/types').ReportHistoryItem[]> => ipcRenderer.invoke('report:list'),
  revealReport: (file: string): Promise<void> => ipcRenderer.invoke('report:reveal', file),
  copyReportImages: (files: string[]): Promise<void> => ipcRenderer.invoke('report:copy-image', files),
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
  downloadVoiceModel: (): Promise<VoiceModelDownloadResult> => trackTask('语音模型下载', () => ipcRenderer.invoke('voice-model:download'), { progress: downloadTaskProgress }),
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
