/// <reference types="vite/client" />
import type { ChatIndexSearchQuery, ChatIndexSearchResponse, IndexedConversationQuery, IndexedConversationResponse, ChatIndexQuery, ChatIndexResponse } from '../shared/chat-index'
import type { ConversationIndexQuery, ConversationIndexResponse, SpeechStatsQuery, SpeechStatsResponse } from '../shared/types'
import type { ReportWritingStyle, SaveReportStyleInput } from '../shared/report-styles'

import type { ReportConversationQuery, ReportConversationResponse, GenerateReportInput, GenerateReportResponse, ReportProgress, DetectResult, FetchKeyResponse, KeyStatus, ModelConfig, ReportMessagesQuery, ReportMessagesResponse, SaveModelConfigInput, SyncResponse, VoiceModelDownloadResult, VoiceModelStatus, WechatAccount } from '../shared/types'

declare global {
  interface Window {
    wetrace: {
      resolveSticker(query: import('../shared/sticker').StickerQuery): Promise<import('../shared/sticker').StickerResponse>
      groupMonitor(query: import('../shared/group-monitor').MonitorQuery): Promise<import('../shared/group-monitor').MonitorResponse>
      listConversationOptions(root?: string): Promise<import('../shared/types').ConversationOptionsResponse>
      loadAiPrompts(): Promise<import('../shared/ai-prompt-settings').AiPromptSettingsResponse>
      saveAiPrompts(input: import('../shared/ai-prompt-settings').SaveAiPromptsInput): Promise<import('../shared/ai-prompt-settings').AiPromptSettingsResponse>
      onAiProgress(callback: (progress: import('../shared/ai-chat').AiChatProgress) => void): () => void
      loadAiKnowledge(): Promise<import('../shared/ai-knowledge').AiKnowledge>
      saveAiKnowledge(input: import('../shared/ai-knowledge').AiKnowledge): Promise<import('../shared/ai-knowledge').AiKnowledge>
      refreshAiHotspots(): Promise<import('../shared/ai-knowledge').HotspotResult>
      cancelAi(requestId: string): Promise<void>
      onAiDelta(callback: (delta: import('../shared/ai-chat').AiChatDelta) => void): () => void
      scheduledMessages(root: string, action: import('../shared/scheduled-messages').SendTaskAction): Promise<import('../shared/scheduled-messages').SendTaskResponse>
      aiEvidence(input: import('../shared/ai-evidence').AiEvidenceQuery): Promise<import('../shared/ai-evidence').AiEvidenceResponse>
      aiMemory(root: string, action: import('../shared/ai-long-term-memory').AiMemoryAction): Promise<import('../shared/ai-long-term-memory').AiMemoryResponse>
      loadAiChatHistory(input: import('../shared/ai-chat-history').LoadAiChatHistoryInput): Promise<import('../shared/ai-chat-history').AiChatHistoryResponse>
      saveAiChatHistory(input: import('../shared/ai-chat-history').SaveAiChatHistoryInput): Promise<import('../shared/ai-chat-history').SaveAiChatHistoryResponse>
      askAi(input: import('../shared/ai-chat').AiChatInput): Promise<import('../shared/ai-chat').AiChatResponse>
      getAppInfo(): Promise<{ version: string; platform: string }>
      selectDirectory(title?: string): Promise<string | null>
      detectWechat(root?: string): Promise<DetectResult>
      listWechatAccounts(root?: string): Promise<WechatAccount[]>
      getMediaCacheStats(): Promise<import('../shared/media-cache').MediaCacheStats>
      getCacheSize(): Promise<number>
      getKeyStatus(root?: string): Promise<KeyStatus>
      fetchKey(root?: string): Promise<FetchKeyResponse>
      onCaptureReady(callback: () => void): () => void
      syncWechat(root?: string): Promise<SyncResponse>
      listReportStyles(): Promise<ReportWritingStyle[]>
      saveReportStyle(input: SaveReportStyleInput): Promise<ReportWritingStyle>
      deleteReportStyle(id: string): Promise<ReportWritingStyle[]>
      loadReportConversation(query: ReportConversationQuery): Promise<ReportConversationResponse>
      generateReport(input: GenerateReportInput): Promise<GenerateReportResponse>
      listReports(): Promise<import('../shared/types').ReportHistoryItem[]>
      revealReport(file: string): Promise<void>
      openReport(file: string): Promise<void>
      onReportProgress(callback: (progress: ReportProgress) => void): () => void
      searchChatIndex(query: ChatIndexSearchQuery): Promise<ChatIndexSearchResponse>
      getIndexedConversation(query: IndexedConversationQuery): Promise<IndexedConversationResponse>
      controlChatIndex(query: ChatIndexQuery): Promise<ChatIndexResponse>
      queryConversationSummary(query: ConversationIndexQuery): Promise<ConversationIndexResponse>
      querySpeechStats(query: SpeechStatsQuery): Promise<SpeechStatsResponse>
      queryReportMessages(query: ReportMessagesQuery): Promise<ReportMessagesResponse>
      watchWechatAccount(root: string): Promise<void>
      unwatchWechatAccount(): Promise<void>
      onDatabaseChanged(callback: (root: string) => void): () => void
      listModelConfigs(): Promise<ModelConfig[]>
      saveModelConfig(input: SaveModelConfigInput): Promise<ModelConfig>
      deleteModelConfig(id: string): Promise<ModelConfig[]>
      setDefaultModelConfig(id: string): Promise<ModelConfig[]>
      testModelConfig(input: SaveModelConfigInput): Promise<{ latencyMs: number }>
      openModelDirectory(id: string): Promise<void>
      transcribeVoiceMessage(query: import('../shared/types').VoiceMessageQuery): Promise<import('../shared/types').VoiceMessageResponse>
      getVoiceModelStatus(): Promise<VoiceModelStatus>
      downloadVoiceModel(): Promise<VoiceModelDownloadResult>
      cancelVoiceModelDownload(): Promise<boolean>
      removeVoiceModel(): Promise<VoiceModelStatus>
      openVoiceModelDirectory(): Promise<void>
      onVoiceModelProgress(callback: (status: VoiceModelStatus) => void): () => void
    }
  }
}

export {}
