import { ScheduledMessages } from './scheduled-messages'
import { NativeMessageTransport } from './message-transport'
import { wechatVersion } from './key-capture'
import { queryAiEvidence } from './ai-evidence'
import { wechatPlatformSupport } from './wechat-platform'
import { AiLongTermMemoryStore } from './ai-long-term-memory'
import { AiChatJobs } from './ai-chat-jobs'
import { AiChatHistoryStore } from './ai-chat-history-store'
import { createOfflineTranscriber } from './offline-voice'
import { VoiceTranscriptionCache } from './voice-transcription-cache'
import { configureConversationCachePolicy } from './conversation-cache-policy'
import { getMediaCacheStats } from './media-cache-stats'
import { listReportHistory } from './report-history'
import { loadAiPrompts, saveAiPrompts } from './ai-prompt-store'
import { loadAiKnowledge, saveAiKnowledge, getHotspots } from './ai-knowledge'
import { answerAiChat, clearAiRecordCaches } from './ai-chat'
import { createReportDiagnostics, reportFailureAdvice } from './report-diagnostics'
import { relaunchWithoutLibraryOverrides } from './startup-environment'
import { app, BrowserWindow, dialog, ipcMain, shell, protocol, safeStorage } from 'electron'
import fs from 'node:fs'
import { configureImagePreviewDirectory } from './image-preview-cache'
import { loadImagePreview, stopRecordsProcess } from './wechat-background'
import { join } from 'node:path'
import { resolveSticker, groupMonitor, listConversationOptions, detectWechat, fetchKey, listWechatAccounts, searchChatIndex, getIndexedConversation, controlChatIndex, queryConversationSummary, querySpeechStats, prepareReportParticipants, prepareReportMedia, queryReportMessages, syncWechat } from './wechat'
import { sipEnabled, wechatProcess, wechatRunning } from './security'
import { deleteModelConfig, listModelConfigs, saveModelConfig, setDefaultModelConfig, testModelConfig } from './model-config-store'
import { listReportStyles, saveReportStyle, deleteReportStyle } from './report-style-store'
import type { SaveReportStyleInput } from '../shared/report-styles'
import { ReportSnapshotStore } from './report-snapshots'
import { generateReport } from './report-generator'
import { VoiceModelManager } from './voice-model-manager'
import type { FetchKeyResponse, KeyStatus, GenerateReportInput, ReportConversationQuery, ReportMessagesQuery, SaveModelConfigInput, ReportProgress } from '../shared/types'

// dyld captures its search paths before JS executes; restart instead of mutating
// the current process environment after native libraries may already be loaded.
if (await relaunchWithoutLibraryOverrides()) app.exit(0)

// A single scheduler owner prevents two app instances from dispatching the same saved task.
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', () => { const window = BrowserWindow.getAllWindows()[0]; if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus() } })

protocol.registerSchemesAsPrivileged([{ scheme: 'wetrace-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    title: 'WeTrace',
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  window.on('ready-to-show', () => window.show())
  window.webContents.on('destroyed', () => stopAccountWatch(window.webContents.id))

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function directorySize(directory: string): number {
  if (!fs.existsSync(directory)) return 0
  let size = 0
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) size += directorySize(file)
    else if (entry.isFile()) size += fs.statSync(file).size
  }
  return size
}

const accountWatchers = new Map<number, fs.FSWatcher[]>()

function stopAccountWatch(webContentsId: number): void {
  for (const watcher of accountWatchers.get(webContentsId) ?? []) watcher.close()
  accountWatchers.delete(webContentsId)
}

app.whenReady().then(() => {
  if (!app.isPackaged && process.platform === 'darwin') app.dock?.setIcon(join(app.getAppPath(), 'build/icon.png'))
  configureConversationCachePolicy(join(app.getPath('userData'), 'cache-policy'))
  const previewDirectory = fs.mkdtempSync(join(app.getPath('temp'), 'wetrace-previews-'))
  configureImagePreviewDirectory(previewDirectory)
  app.once('will-quit', () => { try { fs.rmSync(previewDirectory, { recursive: true, force: true }) } catch { /* Already removed. */ } })
  protocol.handle('wetrace-media', async request => {
    const url = new URL(request.url)
    const id = url.pathname.slice(1)
    const image = url.hostname === 'preview' && /^[a-f0-9]{64}$/.test(id) ? await loadImagePreview(id).catch(() => undefined) : undefined
    return image ? new Response(new Uint8Array(image.data), { headers: { 'Content-Type': image.mime, 'Cache-Control': 'private, max-age=31536000, immutable' } }) : new Response('Image unavailable', { status: 404 })
  })
  ipcMain.handle('app:get-info', () => ({
    version: app.getVersion(),
    platform: process.platform,
  }))

  ipcMain.handle('dialog:select-directory', async (event, title?: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null

    const result = await dialog.showOpenDialog(window, {
      title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 80) : '选择微信数据目录',
      properties: ['openDirectory'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('wechat:group-monitor', async (_event, query: import('../shared/group-monitor').MonitorQuery): Promise<import('../shared/group-monitor').MonitorResponse> => {
    try { return { ok: true, data: await groupMonitor(query) } }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '群聊监控失败' } }
  })
  ipcMain.handle('wechat:sticker', async (_event, query: import('../shared/sticker').StickerQuery): Promise<import('../shared/sticker').StickerResponse> => {
    try { return await resolveSticker(query) }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '表情包加载失败' } }
  })
  ipcMain.handle('wechat:detect', (_event, root?: string) => detectWechat(root))
  ipcMain.handle('wechat:accounts', (_event, root?: string) => listWechatAccounts(root))
  ipcMain.handle('app:media-cache-stats', () => getMediaCacheStats(join(app.getPath('userData'), 'cache')))
  ipcMain.handle('app:cache-size', () => directorySize(join(app.getPath('userData'), 'cache')))
  ipcMain.handle('wechat:watch', (event, accountRoot: string) => {
    stopAccountWatch(event.sender.id)
    const account = listWechatAccounts(accountRoot).find((item) => item.root === accountRoot)
    if (!account) throw new Error('账号目录不存在，无法监听聊天变化')
    const watchers: fs.FSWatcher[] = []
    for (const directory of ['message', 'session', 'contact']) {
      const target = join(account.root, 'db_storage', directory)
      if (!fs.existsSync(target)) continue
      try {
        const watcher = fs.watch(target, (_eventType, filename) => {
          if (!filename || /\.db(?:-wal)?$/i.test(String(filename))) {
            if (!event.sender.isDestroyed()) event.sender.send('wechat:database-changed', account.root)
          }
        })
        watcher.on('error', () => stopAccountWatch(event.sender.id))
        watchers.push(watcher)
      } catch {
        // 定时刷新仍会兜底处理未能监听的目录。
      }
    }
    accountWatchers.set(event.sender.id, watchers)
  })
  ipcMain.handle('wechat:unwatch', (event) => stopAccountWatch(event.sender.id))

  ipcMain.handle('wechat:key-status', async (_event, root?: string): Promise<KeyStatus> => {
    const support = wechatPlatformSupport()
    if (!support.supported) return { supported: false, error: support.error, sipEnabled: false, hasKey: false, wechatRunning: false, wechatLoggedIn: false }
    const [sip, process] = await Promise.all([sipEnabled(), wechatProcess()])
    return {
      sipEnabled: sip,
      hasKey: Boolean((await detectWechat(root)).hasKey),
      wechatRunning: process.running,
      wechatLoggedIn: process.loggedIn,
    }
  })

  ipcMain.handle('wechat:fetch-key', async (event, root?: string): Promise<FetchKeyResponse> => {
    const support = wechatPlatformSupport()
    if (!support.supported) return { ok: false, error: support.error ?? '当前平台暂不支持' }
    if (await sipEnabled()) {
      return { ok: false, error: 'SIP_REQUIRED' }
    }
    if (!(await wechatRunning())) {
      return { ok: false, error: '请先打开微信，并停留在未登录页面。' }
    }
    try {
      await fetchKey(root, () => event.sender.send('wechat:capture-ready'))
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '读取密钥失败' }
    }
  })

  ipcMain.handle('wechat:conversation-options', async (_event, root?: string) => {
    try { return { ok: true as const, conversations: await listConversationOptions(root) } }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : '读取会话列表失败' } }
  })

  let connectedSendAccount: string | undefined
  ipcMain.handle('wechat:sync', async (_event, root?: string) => {
    try {
      const data = await syncWechat({ root })
      if (connectedSendAccount && connectedSendAccount !== data.account.root) scheduledMessages.stop()
      connectedSendAccount = data.account.root
      return { ok: true as const, data }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : '同步失败' }
    }
  })

  ipcMain.handle('wechat:index-search', async (_event, query: import('../shared/chat-index').ChatIndexSearchQuery) => {
    try { return { ok: true as const, matches: await searchChatIndex(query) } }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : '索引搜索失败' } }
  })
  ipcMain.handle('wechat:index-conversation', async (_event, query: import('../shared/chat-index').IndexedConversationQuery) => {
    try { return { ok: true as const, conversation: await getIndexedConversation(query) } }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : '读取会话失败' } }
  })

  ipcMain.handle('wechat:chat-index', async (_event, query: import('../shared/chat-index').ChatIndexQuery) => {
    try { const data = await controlChatIndex(query); if (query.action === 'exclusions') clearAiRecordCaches(); return { ok: true as const, data } }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : '聊天索引操作失败' } }
  })

  ipcMain.handle('wechat:conversation-summary', async (_event, query: import('../shared/types').ConversationIndexQuery) => {
    try { return { ok: true as const, data: await queryConversationSummary(query) } }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : '读取记录总数失败' } }
  })

  ipcMain.handle('wechat:speech-stats', async (_event, query: import('../shared/types').SpeechStatsQuery) => {
    try { return { ok: true as const, data: await querySpeechStats(query) } }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : '读取发言统计失败' } }
  })

  ipcMain.handle('wechat:report-messages', async (_event, query: ReportMessagesQuery) => {
    try {
      return { ok: true as const, data: await queryReportMessages(query) }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : '读取报告记录失败' }
    }
  })

  ipcMain.handle('report-style:list', () => listReportStyles())
  ipcMain.handle('report-style:save', (_event, input: SaveReportStyleInput) => saveReportStyle(input))
  ipcMain.handle('report-style:delete', (_event, id: string) => deleteReportStyle(id))

  ipcMain.handle('ai:prompts-load', () => loadAiPrompts())
  ipcMain.handle('ai:prompts-save', (_event, input: import('../shared/ai-prompt-settings').SaveAiPromptsInput) => saveAiPrompts(input))
  ipcMain.handle('ai:knowledge-load', () => loadAiKnowledge())
  ipcMain.handle('ai:knowledge-save', (_event, input: import('../shared/ai-knowledge').AiKnowledge) => saveAiKnowledge(input))
  ipcMain.handle('ai:hotspots-refresh', () => getHotspots(true))
  const scheduledMessages = new ScheduledMessages(join(app.getPath('userData'), 'scheduled-messages'), new NativeMessageTransport(join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'send-bridge'), wechatVersion, async root => (await listConversationOptions(root)).filter(item => item.type === 'group' || item.type === 'friend')), value => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，未保存发送任务')
    return safeStorage.encryptString(value)
  }, value => { if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用'); return safeStorage.decryptString(value) })
  ipcMain.handle('messages:schedule', async (_event, root: string, action: import('../shared/scheduled-messages').SendTaskAction): Promise<import('../shared/scheduled-messages').SendTaskResponse> => {
    try { if (root !== connectedSendAccount) throw new Error('请先连接该账号后管理发送任务'); const result = await scheduledMessages.update(root, action); return { ok: true, ...result } }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '发送任务操作失败' } }
  })
  const sendTimer = setInterval(() => { if (connectedSendAccount) void scheduledMessages.tick(connectedSendAccount).catch(() => undefined) }, 1000)
  app.on('before-quit', () => { clearInterval(sendTimer); scheduledMessages.stop() })
  ipcMain.handle('ai:evidence', async (_event, input: import('../shared/ai-evidence').AiEvidenceQuery): Promise<import('../shared/ai-evidence').AiEvidenceResponse> => {
    try { return { ok: true, data: await queryAiEvidence(input, queryReportMessages) } }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '读取原文失败' } }
  })
  const longTermMemory = new AiLongTermMemoryStore(join(app.getPath('appData'), 'WeTrace', 'ai-long-term-memory'))
  ipcMain.handle('ai:memory', (_event, root: string, action: import('../shared/ai-long-term-memory').AiMemoryAction): import('../shared/ai-long-term-memory').AiMemoryResponse => {
    try { return { ok: true, memory: longTermMemory.update(root, action) } }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '记忆操作失败' } }
  })
  const aiChatHistory = new AiChatHistoryStore(join(app.getPath('appData'), 'WeTrace', 'ai-conversations'))
  let historyFlushedOnQuit = false
  app.on('before-quit', event => {
    if (historyFlushedOnQuit) return
    event.preventDefault()
    void aiChatHistory.flush().finally(() => { historyFlushedOnQuit = true; app.quit() })
  })
  ipcMain.handle('ai:history-load', async (_event, input: import('../shared/ai-chat-history').LoadAiChatHistoryInput): Promise<import('../shared/ai-chat-history').AiChatHistoryResponse> => {
    try { const stored = await aiChatHistory.load(input); return { ok: true, archive: stored.archive, revision: stored.revision } }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '读取本地对话失败' } }
  })
  ipcMain.handle('ai:history-save', async (_event, input: import('../shared/ai-chat-history').SaveAiChatHistoryInput): Promise<import('../shared/ai-chat-history').SaveAiChatHistoryResponse> => {
    try { return { ok: true, revision: await aiChatHistory.save(input) } }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '保存本地对话失败' } }
  })
  const aiJobs = new AiChatJobs()
  const aiJobOwners = new WeakSet<Electron.WebContents>()
  ipcMain.handle('ai:cancel', (event, requestId: string) => { aiJobs.cancel(event.sender.id, requestId) })
  ipcMain.handle('ai:chat', async (event, input: import('../shared/ai-chat').AiChatInput) => {
    if (!input || typeof input.requestId !== 'string' || !input.requestId || (input.chatId !== undefined && (typeof input.chatId !== 'string' || !input.chatId))) return { ok: false, error: '对话请求无效' }
    let controller: AbortController
    try { controller = aiJobs.start(event.sender.id, input.requestId, JSON.stringify([input.root, input.chatId ?? input.requestId])) }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '无法启动对话' } }
    if (!aiJobOwners.has(event.sender)) {
      aiJobOwners.add(event.sender)
      const owner = event.sender.id
      event.sender.once('destroyed', () => aiJobs.cancelOwner(owner))
    }
    try {
      let queryState: import('../shared/ai-chat').AiQueryState | undefined
      let memory: import('../shared/ai-chat').AiConversationMemory | undefined
      const answer = await answerAiChat(input, text => {
        if (!event.sender.isDestroyed()) event.sender.send('ai:delta', { requestId: input.requestId, text })
      }, controller.signal, detail => {
        if (!event.sender.isDestroyed()) event.sender.send('ai:progress', { requestId: input.requestId, detail })
      }, state => { queryState = state }, value => { memory = value }, budget => longTermMemory.context(input.root, budget))
      return { ok: true, answer, queryState, memory }
    } catch (error) { return { ok: false, error: controller.signal.aborted ? '已停止生成' : error instanceof Error ? error.message : 'AI 对话失败' } }
    finally { aiJobs.finish(event.sender.id, input.requestId) }
  })

  ipcMain.handle('model:list', () => listModelConfigs())
  ipcMain.handle('model:save', async (_event, input: SaveModelConfigInput) => {
    await testModelConfig(input)
    return saveModelConfig(input)
  })
  ipcMain.handle('model:delete', (_event, id: string) => deleteModelConfig(id))
  ipcMain.handle('model:set-default', (_event, id: string) => setDefaultModelConfig(id))
  ipcMain.handle('model:test', (_event, input: SaveModelConfigInput) => testModelConfig(input))
  ipcMain.handle('model:open-directory', async (_event, id: string) => {
    const config = listModelConfigs().find(item => item.id === id && item.source === 'local')
    if (!config?.localPath) throw new Error('本地模型配置已不存在，请刷新列表')
    const error = await shell.openPath(config.localPath)
    if (error) throw new Error(error)
  })

  const voiceModelManager = new VoiceModelManager(join(app.getPath('userData'), 'models', 'sensevoice-small-int8'))
  const listVoiceCache = new VoiceTranscriptionCache(join(app.getPath('userData'), 'cache', 'voice-transcriptions'))
  let listTranscriber: ReturnType<typeof createOfflineTranscriber> | undefined
  let voiceQueue: Promise<unknown> = Promise.resolve()
  ipcMain.handle('wechat:voice-transcribe', async (_event, query: import('../shared/types').VoiceMessageQuery): Promise<import('../shared/types').VoiceMessageResponse> => {
    const task = async (): Promise<import('../shared/types').VoiceMessageResponse> => {
      try {
        if (!query || typeof query.conversationId !== 'string' || !query.conversationId || typeof query.id !== 'string' || !query.id || !Number.isFinite(query.createdAt) || (query.root !== undefined && typeof query.root !== 'string')) throw new Error('语音消息参数无效')
        if ((await voiceModelManager.getStatus()).state !== 'ready') throw new Error('请先在设置 → 语音转文字中下载并校验离线模型')
        const date = new Date(query.createdAt)
        if (!Number.isFinite(date.getTime())) throw new Error('语音消息时间无效')
        const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        const data = await queryReportMessages({ root: query.root, conversationId: query.conversationId, startDate: day, endDate: day, contentTypes: ['voice'], includeVoiceData: true, selectedMessages: [{ id: query.id, createdAt: query.createdAt }] })
        const message = data.messages.find(item => item.id === query.id && item.createdAt === query.createdAt && item.messageType === 34)
        if (!message?.voice?.hex) throw new Error(message?.voice?.unavailable || '未找到本地语音数据，请确认该语音已在微信中下载')
        const result = await listVoiceCache.getOrTranscribe(JSON.stringify([query.root ?? '', query.conversationId]), message.voice.hex, voiceModelManager.cacheVersion, async () => {
          listTranscriber ??= createOfflineTranscriber(voiceModelManager.directory)
          try { return await (await listTranscriber)(message.voice!.hex!) }
          catch (error) { listTranscriber = undefined; throw error }
        })
        return { ok: true, text: result.text, warning: result.warning }
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '语音转写失败' } }
    }
    const pending = voiceQueue.then(task, task)
    voiceQueue = pending
    return pending
  })
  const reportSnapshots = new ReportSnapshotStore(queryReportMessages)
  const snapshotOwners = new WeakSet<Electron.WebContents>()
  ipcMain.handle('report:load-conversation', async (event, query: ReportConversationQuery) => {
    if (!snapshotOwners.has(event.sender)) {
      snapshotOwners.add(event.sender)
      const owner = event.sender.id
      event.sender.once('destroyed', () => reportSnapshots.clear(owner))
    }
    try { return { ok: true, data: await reportSnapshots.load(event.sender.id, query) } }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '读取会话记录失败' } }
  })
  const reportJobs = new Set<number>()
  const reportFiles = new Set<string>()
  ipcMain.handle('report:generate', async (event, input: GenerateReportInput) => {
    if (reportJobs.has(event.sender.id)) return { ok: false, error: '已有报告正在生成，请等待完成' }
    reportJobs.add(event.sender.id)
    const diagnostics = createReportDiagnostics(join(app.getPath('userData'), 'logs', 'reports'), input)
    let last: ReportProgress = { requestId: input.requestId, stage: 'read', percent: 2, detail: '正在从本地索引读取本次日期与内容范围的正文' }
    const send = (progress: ReportProgress) => {
      last = progress
      diagnostics.append({ event: 'progress', ...progress })
      if (!event.sender.isDestroyed()) event.sender.send('report:progress', progress)
    }
    try {
      send(last)
      const messages = await reportSnapshots.forGeneration(event.sender.id, input)
      const data = await generateReport(input, voiceModelManager, progress => {
        send(progress)
      }, messages, message => prepareReportMedia(input.root, input.conversationId, message), participants => prepareReportParticipants(input.root, participants))
      for (const file of [data.htmlPath, ...data.pngPaths]) reportFiles.add(file)
      return { ok: true, data }
    } catch (error) {
      const detail = error instanceof Error ? error.message : '报告生成失败'
      const advice = reportFailureAdvice(detail)
      diagnostics.append({ event: 'failure', stage: last.stage, step: last.detail, percent: last.percent, error: detail, advice })
      const diagnosticPath = diagnostics.path
      if (diagnosticPath) reportFiles.add(diagnosticPath)
      send({ ...last, stage: 'error', failedStage: last.stage, failedStep: last.detail, detail, advice, diagnosticPath })
      return { ok: false, error: detail, advice, diagnosticPath }

    } finally { reportJobs.delete(event.sender.id) }
  })
  ipcMain.handle('report:list', async () => {
    const reports = await listReportHistory(join(app.getPath('documents'), 'WeTrace Reports'))
    for (const report of reports) for (const file of [report.htmlPath, ...report.pngPaths]) reportFiles.add(file)
    return reports
  })
  ipcMain.handle('report:reveal', (_event, file: string) => {
    if (!reportFiles.has(file) || !fs.existsSync(file)) throw new Error('报告文件不存在，请重新生成')
    shell.showItemInFolder(file)
  })
  ipcMain.handle('report:open', async (_event, file: string) => {
    if (!reportFiles.has(file)) throw new Error('报告文件不存在，请重新生成')
    const error = await shell.openPath(file)
    if (error) throw new Error(error)
  })
  voiceModelManager.setProgressListener(status => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send('voice-model:progress', status)
      }
    }
  })
  ipcMain.handle('voice-model:status', () => voiceModelManager.getStatus())
  ipcMain.handle('voice-model:download', () => voiceModelManager.download())
  ipcMain.handle('voice-model:cancel', () => voiceModelManager.cancelDownload())
  ipcMain.handle('voice-model:remove', () => voiceModelManager.remove())
  ipcMain.handle('voice-model:open-directory', async () => {
    await fs.promises.mkdir(voiceModelManager.directory, { recursive: true })
    const error = await shell.openPath(voiceModelManager.directory)
    if (error) throw new Error(error)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', stopRecordsProcess)
