import { preserveConversationAvatars } from '../../shared/conversation-avatars'
import { ScheduledMessagesPanel } from './components/ScheduledMessagesPanel'
import { VoiceMessage } from './components/VoiceMessage'
import { StickerContent } from './components/StickerContent'
import { retainedRecallMessages } from '../../shared/retained-recalls'
import type { MonitorRoom, MonitorState } from '../../shared/group-monitor'
import { ChatText } from './components/ChatText'
import { GroupMonitor } from './components/GroupMonitor'
import { ActionButton } from './components/ui/ActionButton'
import { Alert, Image, Input } from 'antd'
import { DEFAULT_IMAGE_CONCURRENCY, MAX_IMAGE_CONCURRENCY, imageConcurrency } from '../../shared/report-concurrency'
import { ReportHistory } from './components/ReportHistory'
import { ReportMessagePicker } from './components/ReportMessagePicker'
import { reportSelectionDate, selectReportMessages } from '../../shared/report-selection'
import { conversationAiContext } from '../../shared/ai-chat-context'
import type { AiConversationLaunch } from '../../shared/ai-chat'
import { AiChat } from './components/AiChat'
import type { ChatIndexSearchMatch } from '../../shared/chat-index'
import { IndexedSearchResults } from './components/IndexedSearchResults'
import { ChatIndexPanel, useChatIndex } from './components/ChatIndexPanel'
import { createPortal } from 'react-dom'
import { startTransition, memo, Fragment, useEffect, useLayoutEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Sparkles,
  ArrowLeft,
  ArrowRight,
  CircleHelp,
  Check,
  Cpu,
  Database,
  Download,
  FileText,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  Info,
  KeyRound,
  LayoutTemplate,
  MessageCircle,
  Mic,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { ReportMessageSelection, ConversationIndexSummary, ReportConversationSnapshot, ReportConversationResponse, GeneratedReport, ReportProgress, DetectResult, KeyStatus, ModelConfig, ModelKind, ModelSource, ApiFormat, ReportContentType, ReportMessagesResult, SaveModelConfigInput, SyncConversation, SyncMessage, SyncResult, VoiceModelStatus, WechatAccount } from '../../shared/types'

import { SafeText, firstGrapheme } from './components/SafeText'
import { ChatAnalysis } from './components/ChatAnalysis'
import { modelPreset, modelProviders, modelKindLabels } from '../../shared/model-presets'
import { reportMemberKey, reportMemberName, filterReportMessages } from '../../shared/report-messages'
import { defaultReportStyles, type ReportWritingStyle } from '../../shared/report-styles'
import { defaultReportTemplates } from '../../shared/report-templates'

type View = 'send' | 'ai' | 'messages' | 'summary' | 'settings' | 'monitor'
type SettingsPanel = 'db' | 'image' | 'model' | 'asr' | 'cache' | 'about'
type SummaryPanel = 'home' | 'generate' | 'templates' | 'example'
type ReportDatePreset = 'today' | 'yesterday' | 'week' | 'custom'
type ReportFormat = 'mobile' | 'desktop'

const reportContentTypes: { id: ReportContentType; label: string; hint: string }[] = [
  { id: 'message', label: '消息', hint: '文字、链接、引用与其他消息' },
  { id: 'voice', label: '语音', hint: '离线识别并缓存，重试自动复用' },
  { id: 'image', label: '图片', hint: '需要图片理解模型' },
  { id: 'video', label: '视频', hint: '仅纳入统计，不解析内容' },
]

const reportDatePresets: { id: ReportDatePreset; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'yesterday', label: '昨天' },
  { id: 'week', label: '近 7 天' },
  { id: 'custom', label: '自定义' },
]


function toDateInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function daysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return toDateInput(date)
}

const settingsNav: { id: SettingsPanel; label: string; icon: LucideIcon }[] = [
  { id: 'db', label: '数据库与账号', icon: Database },
  { id: 'image', label: '图片解密', icon: ImageIcon },
  { id: 'model', label: '模型配置', icon: Cpu },
  { id: 'asr', label: '语音转文字', icon: Mic },
  { id: 'cache', label: '缓存与索引', icon: HardDrive },
  { id: 'about', label: '关于', icon: Info },
]

function MessageContent({ message, root, conversationId }: { message: SyncMessage; root?: string; conversationId?: string }) {
  const [failedImage, setFailedImage] = useState<string>()
  const [failedVideo, setFailedVideo] = useState<string>()
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false)
  const [previewImage, setPreviewImage] = useState(message.image)
  const [previewNote, setPreviewNote] = useState('')
  const previewRequest = useRef(0)
  const previewOpen = useRef(false)
  async function openImagePreview(open: boolean) {
    if (previewOpen.current === open) return
    previewOpen.current = open
    const request = ++previewRequest.current
    setImagePreviewOpen(open)
    if (!open) return
    setPreviewImage(message.image)
    setPreviewNote(message.image?.thumbnail ? '正在读取原图…' : '')
    if (message.image?.source && message.image.thumbnail === false) return
    if (!root || !conversationId) { setPreviewNote(message.image?.thumbnail ? '本机暂未找到可显示的原图，当前为缩略图。请在微信中打开原图后重试。' : ''); return }
    try {
      const result = await window.wetrace.getIndexedConversation({ root, conversationId, at: message.createdAt, limit: 60 })
      if (request !== previewRequest.current) return
      if (!result.ok) throw new Error(result.error)
      const found = result.conversation.messages.find(item => item.id === message.id)
      const image = found?.image ?? found?.recall?.media?.image
      if (!image?.source) throw new Error('未找到可显示的原图')
      if (!image.thumbnail || !message.image?.source) setPreviewImage(image)
      setPreviewNote(image.thumbnail ? '本机暂未找到可显示的原图，当前为缩略图。请在微信中打开原图后重试。' : '')
    } catch { if (request === previewRequest.current) setPreviewNote('暂未能重新读取原图，当前显示已加载的图片。请刷新聊天记录后重试。') }
  }
  if (message.recall) {
    const retainedLabel = message.recall.media?.video?.source ? '已保留视频'
      : message.recall.media?.image?.source ? '已保留图片'
      : ['[图片]', '[视频]'].includes(message.recall.original) ? '已保留消息说明' : '已保留原文'
    return <div className="message-recalled"><div>{message.recall.media ? <MessageContent message={{ ...message, ...message.recall.media, text: message.recall.original, recall: undefined, revoke: undefined, messageType: message.recall.media.image ? 3 : message.recall.media.video ? 43 : message.recall.media.voice ? 34 : 1 }} root={root} conversationId={conversationId} /> : <ChatText>{message.recall.original}</ChatText>}</div><small className="message-recall-label">已撤回 · {retainedLabel}</small></div>
  }
  if (message.revoke) return <div className="message-revoke-notice"><SafeText>{message.text}</SafeText><small className="message-recall-label">{message.revoke.unresolvedReason === 'capture-gap' ? '捕获窗口存在缺口，未找到对应原文' : message.revoke.unresolvedReason === 'retention-limit' ? '未找到对应原文，较早内容可能已超出保留范围' : message.revoke.unresolvedReason === 'unlinked' ? '已保存会话消息，但暂无法确定对应原文' : '未捕获到可关联的原文'}</small></div>
  if (message.quote) return <><div><MessageContent message={{ ...message, quote: undefined }} root={root} conversationId={conversationId} /></div><blockquote className="message-quote"><b><SafeText>{message.quote.sender}</SafeText></b><span><ChatText>{message.quote.text}</ChatText></span></blockquote></>
  if (message.forwarded) return <details className="message-forwarded"><summary><SafeText>{message.forwarded.title}</SafeText> · {message.forwarded.entries.length ? `${message.forwarded.entries.length} 条记录` : '内容不可用'}</summary>
    {message.forwarded.entries.map((entry, index) => <div className="message-forwarded-entry" key={index}><b><SafeText>{entry.sender}</SafeText></b>{entry.time && <small><SafeText>{entry.time}</SafeText></small>}<div><ChatText>{entry.text}</ChatText></div></div>)}
    {message.forwarded.unavailable && <p>{message.forwarded.unavailable}</p>}
  </details>
  if (message.messageType === 34) return <VoiceMessage key={`${root}:${conversationId}:${message.id}:${message.createdAt}`} message={message} root={root} conversationId={conversationId ?? ''} />
  if (message.sticker) return <StickerContent key={`${root}:${message.sticker.md5}:${message.sticker.cdnUrl}`} sticker={message.sticker} root={root} />
  if (message.video) return message.video.source
    ? <><video className="message-video" src={message.video.source} controls preload="metadata" onError={() => setFailedVideo(message.video?.source)} />{failedVideo === message.video.source && <span className="message-unavailable">视频无法播放，文件可能不完整或编码暂不支持</span>}</>
    : <span className="message-unavailable">{message.video.unavailable || '视频读取失败'}</span>
  if (message.image) {
    return message.image.source && failedImage !== message.image.source
      ? <Image className="message-image" classNames={{ root: 'message-image-preview' }} src={message.image.source} alt="聊天图片" loading="lazy" tabIndex={0} aria-label="查看聊天图片大图" preview={{ open: imagePreviewOpen, onOpenChange: open => { void openImagePreview(open) }, src: previewImage?.source, imageRender: original => <>{original}{previewNote && <div className="image-preview-note" role="status">{previewNote}</div>}</> }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openImagePreview(true) } }} onError={() => { previewOpen.current = false; previewRequest.current++; setImagePreviewOpen(false); setFailedImage(message.image?.source) }} />
      : <span className="message-unavailable">{message.image.unavailable || '图片读取失败'}</span>
  }
  if (message.link) {
    return <a className="message-link" href={message.link.url} target="_blank" rel="noopener noreferrer">
      <strong><SafeText>{message.link.title}</SafeText></strong>
      {message.link.description && <span><SafeText>{message.link.description}</SafeText></span>}
      <small><SafeText>{message.link.url}</SafeText></small>
    </a>
  }
  return <>{message.text.split(/(https?:\/\/[^\s<>]+)/g).map((part, index) =>
    /^https?:\/\//.test(part)
      ? <a key={index} href={part} target="_blank" rel="noopener noreferrer"><SafeText>{part}</SafeText></a>
      : <Fragment key={index}><ChatText>{part}</ChatText></Fragment>
  )}</>
}

function sameMessage(left: SyncMessage, right: SyncMessage): boolean {
  return left.id === right.id && left.createdAt === right.createdAt && left.messageType === right.messageType && left.from === right.from && left.sender === right.sender && left.avatar === right.avatar && left.text === right.text && left.time === right.time
    && JSON.stringify(left.revoke) === JSON.stringify(right.revoke)
    && left.recall?.original === right.recall?.original && left.recall?.originalAt === right.recall?.originalAt && left.recall?.media === right.recall?.media
    && left.image?.source === right.image?.source && left.image?.unavailable === right.image?.unavailable && left.image?.thumbnail === right.image?.thumbnail
    && left.video?.source === right.video?.source && left.video?.unavailable === right.video?.unavailable
    && JSON.stringify(left.sticker) === JSON.stringify(right.sticker)
    && left.link?.url === right.link?.url && left.link?.title === right.link?.title && left.link?.description === right.link?.description
    && JSON.stringify(left.forwarded) === JSON.stringify(right.forwarded)
    && left.quote?.sender === right.quote?.sender && left.quote?.text === right.quote?.text
}

const ChatMessages = memo(function ChatMessages({ conversation, accountName, accountAvatar, monitorRoom, root }: { conversation: SyncConversation; accountName: string; accountAvatar?: string; monitorRoom?: MonitorRoom; root?: string }) {
  return <><div className="daydiv"><span>{conversation.day}</span></div>{retainedRecallMessages(conversation.messages, monitorRoom).map((message) => {
    if ([10000, 10002].includes(message.messageType >>> 0) && !message.recall) {
      return <div className="mrow message-system" key={`${conversation.id}:${message.id}`} data-message-id={message.id}>
        <div className="message-system-text"><MessageContent message={message} root={root} conversationId={conversation.id} /></div>
      </div>
    }
    const senderName = message.sender || (message.from === 'me' ? accountName : conversation.name)
    const avatar = message.from === 'me' ? accountAvatar : message.avatar ?? (conversation.type === 'group' ? undefined : conversation.avatar)
    return <div className={`mrow${message.from === 'me' ? ' me' : ''}`} key={`${conversation.id}:${message.id}`} data-message-id={message.id}>
      <ProfileAvatar name={senderName} avatar={avatar} className="av" /><div className="message-body">
        {(message.from === 'me' || Boolean(message.sender)) && <div className="sender"><SafeText>{senderName}</SafeText></div>}
        <div className="message-line"><div className="bubble"><MessageContent message={message} root={root} conversationId={conversation.id} /></div><div className="tm">{message.time}</div></div>
      </div>
    </div>
  })}</>
}, (left, right) => left.root === right.root && left.monitorRoom === right.monitorRoom && left.accountName === right.accountName && left.accountAvatar === right.accountAvatar && left.conversation.id === right.conversation.id && left.conversation.name === right.conversation.name && left.conversation.avatar === right.conversation.avatar && left.conversation.day === right.conversation.day && left.conversation.messages.length === right.conversation.messages.length && left.conversation.messages.every((message, index) => sameMessage(message, right.conversation.messages[index])))

function Field({ title, hint, required = false, children }: { title: string; hint?: string; required?: boolean; children: ReactNode }) {
  const hintId = useId()
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  const showHint = (button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect()
    setAnchor({ left: Math.max(12, Math.min(rect.right - 280, window.innerWidth - 292)), top: rect.bottom + 8 })
  }
  useEffect(() => {
    if (!anchor) return
    const dismiss = () => setAnchor(null)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [anchor])
  return (
    <div className="field">
      <div className="fl">
        <b><SafeText>{title}</SafeText>{required && <span className="required-mark" aria-hidden="true">*</span>}</b>
        {hint && <button type="button" className="field-help" aria-label={`${title}说明`} aria-describedby={anchor ? hintId : undefined}
          onMouseEnter={event => showHint(event.currentTarget)} onMouseLeave={() => setAnchor(null)}
          onFocus={event => showHint(event.currentTarget)} onBlur={() => setAnchor(null)}
          onKeyDown={event => { if (event.key === 'Escape') setAnchor(null) }}><CircleHelp size={14} aria-hidden="true" /></button>}
      </div>
      <div className="fc">{children}</div>
      {hint && anchor && createPortal(<div id={hintId} role="tooltip" className="field-help-tooltip" style={{ left: anchor.left, top: anchor.top }}><SafeText>{hint}</SafeText></div>, document.body)}
    </div>
  )
}

function ModelConfigEditor({
  config,
  saving,
  testingId,
  onSave,
  onTest,
  onCancel,
}: {
  config: ModelConfig
  saving: boolean
  testingId: string | null
  onSave: (input: SaveModelConfigInput) => Promise<void>
  onTest: (input: SaveModelConfigInput, testingId?: string) => Promise<void>
  onCancel: () => void
}) {
  const kind = config.kind ?? 'text'
  const [source, setSource] = useState<ModelSource>(config.source ?? 'remote')
  const [name, setName] = useState(config.name || config.model)
  const [provider, setProvider] = useState(config.provider)
  const [apiFormat, setApiFormat] = useState<ApiFormat>(config.apiFormat ?? 'openai')
  const [baseUrl, setBaseUrl] = useState(config.baseUrl)
  const [modelName, setModelName] = useState(config.model)
  const [localPath, setLocalPath] = useState(config.localPath ?? '')
  const [apiKey, setApiKey] = useState('')
  const editorTestingId = `edit:${config.id}`

  function applyPreset(nextProvider: string, nextFormat: ApiFormat) {
    const preset = modelPreset(nextProvider, nextFormat, kind)
    setProvider(nextProvider)
    setApiFormat(nextFormat)
    setBaseUrl(preset.baseUrl)
    setModelName(preset.model)
    if (nextProvider !== provider) setApiKey('')
  }

  function changeSource(nextSource: ModelSource) {
    setSource(nextSource)
    if (nextSource === 'local') {
      setProvider('本地模型')
      setApiFormat('openai')
      setBaseUrl('')
      setApiKey('')
    } else if (provider === '本地模型') {
      setProvider('自定义')
    }
  }

  function input(): SaveModelConfigInput {
    return { id: config.id, name, provider, kind, source, apiFormat, baseUrl, model: modelName, localPath, apiKey }
  }

  return (
    <div className="group">
      <Field title="配置名称" hint="用于后续选择模型"><Input className="inp" value={name} onChange={event => setName(event.target.value)} placeholder="例如：日常总结模型" /></Field>
      {kind === 'speech' && <Field title="模型来源" hint="本地模型需要指定模型文件所在目录">
        <select className="inp provider" value={source} onChange={event => changeSource(event.target.value as ModelSource)}><option value="remote">在线服务</option><option value="local">本地模型</option></select>
      </Field>}
      {source === 'remote' ? <>
        <Field title="模型模板" hint="选择后自动填写地址与模型 ID">
          <select className="inp provider" value={provider} onChange={event => applyPreset(event.target.value, apiFormat)}>
            {[...new Set([...modelProviders, provider])].map(item => <option key={item}>{item}</option>)}
          </select>
        </Field>
        <Field title="接口格式" hint="默认 OpenAI">
          <select className="inp provider" value={apiFormat} onChange={event => applyPreset(provider, event.target.value as ApiFormat)}><option value="openai">base_url (OpenAI)</option><option value="anthropic">base_url (Anthropic)</option></select>
        </Field>
        <Field title="Base URL" hint={apiFormat === 'anthropic' ? 'Anthropic 兼容地址，不含 /messages' : 'OpenAI 兼容地址，不含 /chat/completions'}><Input className="inp" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" spellCheck={false} /></Field>
      </> : <Field title="模型目录" hint="选择包含本地模型文件的目录">
        <Input className="inp" value={localPath} onChange={event => setLocalPath(event.target.value)} placeholder="/path/to/speech-model" spellCheck={false} />
        <ActionButton type="button" className="btn sm" onClick={() => void window.wetrace.selectDirectory('选择本地语音模型目录').then(directory => { if (directory) setLocalPath(directory) }).catch(() => undefined)}><FolderOpen size={13} />选择目录</ActionButton>
      </Field>}
      <Field title={source === 'local' ? '模型名称' : '模型 ID'} hint={source === 'local' ? '例如 SenseVoice Small INT8' : '支持填写任意服务商提供的模型 ID'}><Input className="inp" value={modelName} onChange={event => setModelName(event.target.value)} placeholder={source === 'local' ? 'SenseVoice Small INT8' : kind === 'text' ? 'deepseek-chat' : '填写图片模型 ID'} spellCheck={false} /></Field>
      {source === 'remote' && <Field title="API Key" hint="加密保存在本机">
        <Input className="inp" type="password" value={apiKey} placeholder={config.hasApiKey ? '已保存；留空则保持原密钥' : '输入 API Key'} onChange={event => setApiKey(event.target.value)} autoComplete="off" />
        <ActionButton type="button" className="btn sm" disabled={saving || testingId !== null} onClick={() => void onTest(input(), editorTestingId)}>{testingId === editorTestingId ? '测试中…' : '测试连接'}</ActionButton>
      </Field>}
      <Field title="保存配置" hint="更新当前模型">
        {source === 'local' && <ActionButton type="button" className="btn sm" disabled={saving || testingId !== null} onClick={() => void onTest(input(), editorTestingId)}>{testingId === editorTestingId ? '检测中…' : '检测目录'}</ActionButton>}
        <ActionButton type="button" className="btn sm" disabled={saving} onClick={onCancel}>取消</ActionButton>
        <ActionButton type="button" className="btn sm primary" disabled={saving || testingId !== null} onClick={() => void onSave(input())}>{saving ? '保存中…' : '保存修改'}</ActionButton>
      </Field>
    </div>
  )
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      className={`switch${checked ? ' on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
    />
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = -1
  do {
    value /= 1024
    unit += 1
  } while (value >= 1024 && unit < units.length - 1)
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

function ProfileAvatar({
  name,
  avatar,
  className = '',
  children,
}: {
  name: string
  avatar?: string
  className?: string
  children?: ReactNode
}) {
  const [failed, setFailed] = useState(false)
  const label = name.trim() || '微信用户'

  useEffect(() => setFailed(false), [avatar])

  return (
    <span className={`profile-avatar${className ? ` ${className}` : ''}`}>
      {avatar && !failed
        ? <img src={avatar} alt="" onError={() => setFailed(true)} />
        : <SafeText>{firstGrapheme(label) || '微'}</SafeText>}
      {children}
    </span>
  )
}

function SipGuide({
  open,
  onClose,
  onRetry,
  onCopied,
}: {
  open: boolean
  onClose: () => void
  onRetry: () => void
  onCopied: () => void
}) {
  if (!open) return null

  const steps = [
    '关机，然后长按电源键约 10 秒，直到出现「正在载入启动选项」。',
    '点击「选项」，输入开机密码，进入恢复模式。',
    '在顶部菜单选择「实用工具」→「终端」。',
    '输入 csrutil disable 并回车，然后从菜单重启电脑。',
  ]

  return (
    <div className="modal-mask" role="dialog" aria-modal="true" aria-label="关闭 SIP 指引">
      <div className="modal">
        <div className="modal-head">
          <div>
            <h3>需要临时关闭系统完整性保护</h3>
            <p>这一步只能在 macOS 恢复模式完成，应用无法代为执行。</p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p className="modal-note">
            微信 4.x 的数据库密钥需要在登录时从微信进程中捕获。SIP 会阻止读取进程内存；关闭后仍需完成管理员授权，并在监听启动后登录微信。
          </p>
          <ol className="modal-steps">
            {steps.map((text) => <li key={text}>{text}</li>)}
          </ol>
          <div className="code-row">
            <code>csrutil disable</code>
            <ActionButton
              type="button"
              className="btn sm"
              onClick={() => {
                void navigator.clipboard?.writeText('csrutil disable').then(onCopied).catch(() => undefined)
              }}
            >
              复制命令
            </ActionButton>
          </div>
          <p className="modal-foot">重启回到桌面后，让微信停在未登录页面，先启动监听，再登录微信。</p>
        </div>
        <div className="modal-actions">
          <ActionButton type="button" className="btn" onClick={onClose}>稍后再说</ActionButton>
          <ActionButton type="button" className="btn primary" onClick={onRetry}>我已关闭，重新检测</ActionButton>
        </div>
      </div>
    </div>
  )
}

function LoginFlow({
  detected,
  status,
  step,
  captureStage,
  syncing,
  refreshing,
  keyError,
  message,
  error,
  onStep,
  onRefresh,
  onOpenSipGuide,
  onStartListening,
  onSync,
}: {
  detected: DetectResult | null
  status: KeyStatus | null
  step: number
  captureStage: 'idle' | 'listening' | 'ready'
  syncing: boolean
  refreshing: boolean
  keyError: string
  message: string
  error: string
  onStep: (step: number) => void
  onRefresh: () => void
  onOpenSipGuide: () => void
  onStartListening: () => void
  onSync: () => void
}) {
  const [elapsed, setElapsed] = useState(0)
  const account = detected?.account ?? null
  const hasKey = Boolean(detected?.hasKey)
  const sipDone = status?.sipEnabled === false
  const wechatRunning = status?.wechatRunning === true
  const wechatLoggedIn = status?.wechatLoggedIn === true
  const wechatReady = wechatRunning && !wechatLoggedIn
  const capturing = captureStage !== 'idle'

  useEffect(() => {
    if (!capturing) {
      setElapsed(0)
      return
    }
    const started = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [capturing])

  if (status?.supported === false) return <main className="login"><section className="login-card" aria-label="连接本机微信"><h3>当前环境暂不支持</h3><p role="alert">{status.error || '当前平台暂不支持连接微信'}</p><ActionButton className="btn" onClick={onRefresh} disabled={refreshing}>重新检查</ActionButton></section></main>

  return (
    <main className="login">
      <div className="login-glow" />
      <div className="login-wrap">
        <section className="login-copy">
          <div className="brandmark">WeTrace</div>
          <h1>先把聊天记录<br /><span>安全地留在本机</span></h1>
          <p>WeTrace 读取你电脑上的微信数据，在本机解密并展示最近的会话消息。原始消息不会上传到任何服务器。</p>
          <ul>
            <li><b>只读</b><span>数据读取不改写微信数据库</span></li>
            <li><b>本地</b><span>当前读取结果只保留在本次应用会话中</span></li>
            <li><b>可控</b><span>只有你配置的模型服务会收到文本片段</span></li>
          </ul>
        </section>

        <section className="login-card" aria-label="连接本机微信">
          <div className="lc-head"><b>连接本机微信</b><span>STEP {step + 1} / 4</span></div>

          <div className="wsteps" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <Fragment key={index}>
                {index > 0 && <i className="wsteps-line" />}
                <span className={`wsteps-dot${index < step ? ' done' : ''}${index === step ? ' on' : ''}`}>
                  {index < step ? <Check size={11} strokeWidth={2.6} /> : index + 1}
                </span>
              </Fragment>
            ))}
          </div>

          {step === 0 && (
            <div className="wbody">
              <div className="wtitle">
                <h3>关闭系统完整性保护</h3>
                <p>SIP 会阻止 WeTrace 读取微信进程内存中的数据库密钥。这一步只能在 macOS 恢复模式完成，取到密钥后可以立刻重新开启。</p>
              </div>
              <div className="detect">
                <div className="dr">
                  <span className="k">系统完整性保护（SIP）</span>
                  <span className="v">
                    {!status
                      ? <span className="subtle">检测中…</span>
                      : sipDone
                        ? <span className="badge-ok">已关闭</span>
                        : <span className="badge-warn">仍处于开启</span>}
                  </span>
                </div>
              </div>
              {sipDone ? (
                <div className="wnote ok">
                  <b>已关闭</b>
                  <span>完成初始化后，可以在恢复模式里用 csrutil enable 重新开启。</span>
                </div>
              ) : (
                <div className="wnote warn">
                  <b>需要手动关闭</b>
                  <span>按教程操作并重启后，回到这里点击「重新检测」确认结果。</span>
                  <ActionButton type="button" className="btn sm" onClick={onOpenSipGuide}>查看恢复模式教程</ActionButton>
                </div>
              )}
              <div className="wstep-actions">
                <ActionButton type="button" className="btn" disabled={refreshing} onClick={onRefresh}>
                  <RefreshCw size={13} className={refreshing ? 'spin' : undefined} />
                  {refreshing ? '检测中' : '重新检测'}
                </ActionButton>
                <ActionButton type="button" className="btn primary" disabled={!sipDone} onClick={() => onStep(1)}>下一步</ActionButton>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="wbody">
              <div className="wtitle">
                <h3>让微信停在登录页面</h3>
                <p>数据库密钥只在微信登录的那一刻出现在进程内存里。请先在微信中退出当前账号，保持未登录的登录页面。</p>
              </div>
              <div className="detect">
                <div className="dr">
                  <span className="k">微信进程</span>
                  <span className="v">
                    {!status
                      ? <span className="subtle">检测中…</span>
                      : wechatRunning
                        ? <span className="badge-ok">运行中</span>
                        : <span className="badge-warn">未运行</span>}
                  </span>
                </div>
                <div className="dr">
                  <span className="k">账号状态</span>
                  <span className="v">
                    {!status
                      ? <span className="subtle">检测中…</span>
                      : wechatLoggedIn
                        ? <span className="badge-warn">已登录</span>
                        : <span className="badge-ok">未登录</span>}
                  </span>
                </div>
              </div>
              {!status ? null : wechatReady ? (
                <div className="wnote ok">
                  <b>已停在登录页面</b>
                  <span>可以进入下一步，准备获取数据库密钥。</span>
                </div>
              ) : (
                <div className="wnote warn">
                  <b>{wechatRunning ? '微信已登录' : '微信未运行'}</b>
                  <span>
                    {wechatRunning
                      ? '请在微信中退出账号，停在登录页面后重新检测。'
                      : '请先打开微信，并保持未登录的登录页面。'}
                  </span>
                </div>
              )}
              <div className="wstep-actions">
                <ActionButton type="button" className="btn" onClick={() => onStep(0)}>上一步</ActionButton>
                <ActionButton type="button" className="btn" disabled={refreshing} onClick={onRefresh}>
                  <RefreshCw size={13} className={refreshing ? 'spin' : undefined} />
                  {refreshing ? '检测中' : '重新检测'}
                </ActionButton>
                <ActionButton type="button" className="btn primary" disabled={!wechatReady} onClick={() => onStep(2)}>下一步</ActionButton>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="wbody">
              <div className="wtitle">
                <h3>{hasKey ? '密钥已获取' : '获取数据库密钥'}</h3>
                <p>
                  {hasKey
                    ? '数据库密钥已保存在本机安全存储，无需重复获取，可以直接进入同步。'
                    : '点击「开始监听」并完成系统授权。看到“监听已就绪”后，再回到微信点击“登录”。'}
                </p>
              </div>
              <div className="detect">
                <div className="dr">
                  <span className="k">数据库密钥</span>
                  <span className="v">
                    {hasKey ? <span className="badge-ok">已获取</span> : <span className="badge-warn">待获取</span>}
                  </span>
                </div>
                {!hasKey && (
                  <div className="dr">
                    <span className="k">监听状态</span>
                    <span className="v">
                      {captureStage === 'listening'
                        ? '正在启动…'
                        : captureStage === 'ready'
                          ? <span className="badge-ok">已就绪</span>
                          : '未开始'}
                    </span>
                  </div>
                )}
              </div>
              {hasKey ? (
                <div className="wnote ok">
                  <b>已完成</b>
                  <span>密钥仅保存在本机，无需重复获取。</span>
                </div>
              ) : captureStage === 'listening' ? (
                <div className="wnote">
                  <b>正在附加监听</b>
                  <span>请完成系统管理员授权，暂时不要点击微信“登录”。</span>
                </div>
              ) : captureStage === 'ready' ? (
                <>
                  <div className="wnote ok">
                    <b>监听已就绪</b>
                    <span>现在回微信点击“登录”，捕获成功后会自动验证数据库。</span>
                  </div>
                  <p className="login-msg" aria-live="polite">已等待 {elapsed} 秒 · 本次捕获约 2 分钟后超时</p>
                </>
              ) : (
                <div className="wnote">
                  <b>操作顺序</b>
                  <span>
                    1. 点击「开始监听」，完成系统管理员授权。<br />
                    2. 看到“监听已就绪”后，回微信点击“登录”。<br />
                    3. 捕获成功后自动验证数据库，进入下一步。
                  </span>
                </div>
              )}
              {keyError && <div className="login-msg error">{keyError}</div>}
              <div className="wstep-actions">
                <ActionButton type="button" className="btn" disabled={capturing} onClick={() => onStep(1)}>上一步</ActionButton>
                {hasKey ? (
                  <ActionButton type="button" className="btn primary" onClick={() => onStep(3)}>下一步</ActionButton>
                ) : (
                  <ActionButton type="button" className="btn primary" disabled={capturing} onClick={onStartListening}>
                    {captureStage === 'listening' ? '正在启动监听…' : captureStage === 'ready' ? '等待微信登录…' : '开始监听'}
                  </ActionButton>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="wbody">
              <div className="wtitle">
                <h3>同步本地消息</h3>
                <p>读取并解密本机微信数据库，展示最近的会话消息。原始消息只留在这台电脑上。</p>
              </div>
              <div className="detect">
                <div className="dr">
                  <span className="k">当前账号</span>
                  <span className="v mono">{account ? account.wxid : '未检测到'}</span>
                </div>
                <div className="dr">
                  <span className="k">数据目录</span>
                  <span className="v mono subtle">{account ? account.id : 'xwechat_files'}</span>
                </div>
                <div className="dr">
                  <span className="k">数据库密钥</span>
                  <span className="v">
                    {hasKey ? <span className="badge-ok">已获取</span> : <span className="badge-warn">待获取</span>}
                  </span>
                </div>
              </div>
              <div className={`login-msg${error || detected?.error ? ' error' : ''}`}>
                {error || detected?.error || message || '点击下方按钮开始同步。'}
              </div>
              <div className="wstep-actions">
                <ActionButton type="button" className="btn" disabled={syncing} onClick={() => onStep(2)}>上一步</ActionButton>
                <ActionButton type="button" className="btn primary" disabled={syncing || !hasKey} onClick={onSync}>
                  {syncing ? '正在同步…' : '开始同步并进入'}
                </ActionButton>
              </div>
            </div>
          )}

          <div className="login-foot">
            <span>仅本机 · 不上传</span>
          </div>
        </section>
      </div>
    </main>
  )
}

export default function App() {
  const [entered, setEntered] = useState(false)
  const [monitorData, setMonitorData] = useState<{ root: string; state: MonitorState }>()
  const [view, setView] = useState<View>('messages')
  const [aiLaunch, setAiLaunch] = useState<AiConversationLaunch>()
  const [analysisConversation, setAnalysisConversation] = useState<SyncConversation | null>(null)
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel>('db')
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'all' | 'friend' | 'group' | 'official'>('group')
  const [toast, setToast] = useState('')
  const [real, setReal] = useState<SyncResult | null>(null)
  const [detected, setDetected] = useState<DetectResult | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [syncMessage, setSyncMessage] = useState('')
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [sipGuide, setSipGuide] = useState(false)
  const [loginStep, setLoginStep] = useState(0)
  const [captureStage, setCaptureStage] = useState<'idle' | 'listening' | 'ready'>('idle')
  const [keyError, setKeyError] = useState('')
  const [rootDir, setRootDir] = useState<string | null>(() => window.localStorage.getItem('wetrace:selected-account-root'))
  useEffect(() => setAnalysisConversation(null), [rootDir])
  const [accounts, setAccounts] = useState<WechatAccount[]>([])
  const [profileOpen, setProfileOpen] = useState(false)
  const profileButton = useRef<HTMLButtonElement>(null)
  const profilePopover = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!profileOpen) return
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !profileButton.current?.contains(event.target) && !profilePopover.current?.contains(event.target)) setProfileOpen(false)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setProfileOpen(false); profileButton.current?.focus() }
    }
    document.addEventListener('pointerdown', dismissOutside, true)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [profileOpen])
  const [autoSyncError, setAutoSyncError] = useState('')
  const [mediaCacheStats, setMediaCacheStats] = useState<import('../../shared/media-cache').MediaCacheStats | null>(null)
  const [mediaCacheError, setMediaCacheError] = useState('')
  const [mediaCacheBusy, setMediaCacheBusy] = useState(false)
  const [cacheBytes, setCacheBytes] = useState<number | null>(null)
  const [modelConfigName, setModelConfigName] = useState('')
  const [provider, setProvider] = useState('DeepSeek')
  const [modelKind, setModelKind] = useState<ModelKind>('text')
  const [modelSource, setModelSource] = useState<ModelSource>('remote')
  const [apiFormat, setApiFormat] = useState<ApiFormat>('openai')
  const [baseUrl, setBaseUrl] = useState(modelPreset().baseUrl)
  const [modelName, setModelName] = useState(modelPreset().model)
  const [localModelPath, setLocalModelPath] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([])
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [savingModel, setSavingModel] = useState(false)
  const [testingModelId, setTestingModelId] = useState<string | null>(null)
  const [voiceModelStatus, setVoiceModelStatus] = useState<VoiceModelStatus | null>(null)
  const [voiceModelBusy, setVoiceModelBusy] = useState(false)
  const [summaryPanel, setSummaryPanel] = useState<SummaryPanel>('home')
  const [reportTask, setReportTask] = useState<{
    conversationId: string; conversationName: string; avatar?: string; target: string
    startDate: string; endDate: string; messageCount: number; style: string
    model: string; imageModel?: string; concurrency?: number; selectionOnly: boolean; startedAt: number
  } | null>(null)
  const [reportRunning, setReportRunning] = useState(false)
  const [reportProgress, setReportProgress] = useState<ReportProgress | null>(null)
  const [generatedReport, setGeneratedReport] = useState<GeneratedReport | null>(null)
  const [copyingReportImage, setCopyingReportImage] = useState(false)
  const reportRequestId = useRef('')
  useEffect(() => window.wetrace.onReportProgress(progress => {
    if (progress.requestId === reportRequestId.current) setReportProgress(current => progress.stage === 'error' ? { ...progress, media: progress.media ?? current?.media, percent: current?.percent ?? 0, failedStep: progress.failedStep ?? current?.detail, detail: progress.detail } : progress)
  }), [])
  const [chatPicking, setChatPicking] = useState(false)
  const [chatPicks, setChatPicks] = useState<ReportMessageSelection[]>([])
  const [reportScope, setReportScope] = useState<{ conversationId: string; items: ReportMessageSelection[] } | null>(null)
  useEffect(() => setReportScope(null), [rootDir])
  const [reportConversationId, setReportConversationId] = useState('')
  const [reportTargetKey, setReportTargetKey] = useState('')
  useEffect(() => setReportTargetKey(''), [reportConversationId, rootDir])
  const [reportQuery, setReportQuery] = useState('')
  const [reportType, setReportType] = useState<'all' | 'friend' | 'group'>('all')
  const [reportDatePreset, setReportDatePreset] = useState<ReportDatePreset>('today')
  const [reportStartDate, setReportStartDate] = useState(() => toDateInput(new Date()))
  const [reportEndDate, setReportEndDate] = useState(() => toDateInput(new Date()))
  const [reportContent, setReportContent] = useState<Record<ReportContentType, boolean>>({ message: true, voice: true, image: true, video: true })
  const [reportSnapshot, setReportSnapshot] = useState<{ key: string; data: ReportConversationSnapshot } | null>(null)
  const [reportSelectionVersion, setReportSelectionVersion] = useState(0)
  const reportLoadCache = useRef<{ key: string; promise: Promise<ReportConversationResponse>; data?: ReportConversationSnapshot } | null>(null)
  const [reportDataLoading, setReportDataLoading] = useState(false)
  const [reportDataError, setReportDataError] = useState('')
  const [reportModelId, setReportModelId] = useState('')
  const [reportImageConcurrency, setReportImageConcurrency] = useState(String(DEFAULT_IMAGE_CONCURRENCY))
  const [reportImageModelId, setReportImageModelId] = useState('')
  const [reportStyle, setReportStyle] = useState('default')
  const [reportStyles, setReportStyles] = useState<ReportWritingStyle[]>(defaultReportStyles)
  const [reportStyleEditing, setReportStyleEditing] = useState(false)
  const [reportStyleEditingId, setReportStyleEditingId] = useState<string | undefined>()
  const [reportStyleName, setReportStyleName] = useState('')
  const [reportStyleDraft, setReportStyleDraft] = useState('')
  const [reportStyleSaving, setReportStyleSaving] = useState(false)
  const [reportFormat, setReportFormat] = useState<ReportFormat>('mobile')
  const [reportTemplateId, setReportTemplateId] = useState(defaultReportTemplates[0].id)
  const [appVersion, setAppVersion] = useState('0.1.0')
  const [appPlatform, setAppPlatform] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const chatContentRef = useRef<HTMLDivElement>(null)
  const followChatBottom = useRef(true)
  const previousChatScrollTop = useRef(0)
  const historyAnchor = useRef<{ key: string; id?: string; offset: number; top: number; height: number } | null>(null)
  const stepInited = useRef(false)
  const startupSyncStarted = useRef(false)
  const [refreshingConversation, setRefreshingConversation] = useState(false)
  const conversationRefreshInFlight = useRef(false)
  const syncInFlightRoots = useRef(new Set<string>())
  const syncAgainRoots = useRef(new Set<string>())
  const activeAccountRootRef = useRef(real?.account.root)
  activeAccountRootRef.current = real?.account.root
  const activeRootRef = useRef(rootDir)
  const syncGeneration = useRef(0)
  const indexedConversationRef = useRef<{ root: string; conversation: SyncConversation; at?: number } | null>(null)

  const chatIndexState = useChatIndex(entered ? real?.account.root : undefined)
  const list = real?.conversations ?? []
  const imageStats = useMemo(() => {
    const messages = real?.conversations.flatMap(conversation => conversation.messages).filter(message => message.image) ?? []
    return { total: messages.length, available: messages.filter(message => message.image?.source).length }
  }, [real])
  const account = real?.account ?? detected?.account ?? null
  const accountName = account?.nickname || account?.wxid || '我的账号'
  const dataHealthy = Boolean(real) && !syncError && !autoSyncError
  const dataStatusText = dataHealthy ? '数据获取正常' : syncError || autoSyncError ? '数据获取异常' : '等待获取数据'
  const displayDirectory = account?.root ?? rootDir ?? '未检测到微信数据目录'
  const filteredConversations = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase()
    return list.filter((conversation) => {
      const matchesType = type === 'all' || conversation.type === type
      const matchesQuery = !keyword || [conversation.name, conversation.preview, ...conversation.messages.flatMap((message) => [message.text, message.quote?.text ?? '', message.quote?.sender ?? ''])]
        .some((text) => text.toLocaleLowerCase().includes(keyword))
      return matchesType && matchesQuery
    })
  }, [list, query, type])

  const selected = filteredConversations.find(conversation => conversation.id === selectedId) ?? filteredConversations[0]
  useEffect(() => { setChatPicking(false); setChatPicks([]) }, [selected?.id, rootDir])
  const [conversationSummary, setConversationSummary] = useState<{ key: string; data?: ConversationIndexSummary; error?: string } | null>(null)
  const [summaryRetry, setSummaryRetry] = useState(0)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyEndKey, setHistoryEndKey] = useState<string | null>(null)
  const historyRequest = useRef(false)
  const currentConversationKey = useRef('')
  const conversationSummaryKey = JSON.stringify([real?.account.root ?? rootDir, selected?.id])
  currentConversationKey.current = conversationSummaryKey
  useEffect(() => {
    if (!entered || view !== 'messages' || !selected) return
    let active = true
    setConversationSummary(current => current?.key === conversationSummaryKey && current.data ? current : { key: conversationSummaryKey })
    void window.wetrace.queryConversationSummary({ root: real?.account.root ?? rootDir ?? undefined, conversationId: selected.id }).then(response => {
      if (!active) return
      setConversationSummary(response.ok ? { key: conversationSummaryKey, data: response.data } : { key: conversationSummaryKey, error: response.error })
    }).catch(error => {
      if (active) setConversationSummary({ key: conversationSummaryKey, error: error instanceof Error ? error.message : '读取记录总数失败' })
    })
    return () => { active = false }
  }, [entered, view, conversationSummaryKey, selected?.type, real?.syncedAt, summaryRetry])
  const indexedSummary = conversationSummary?.key === conversationSummaryKey ? conversationSummary : null
  const indexedRange = indexedSummary?.data?.firstAt != null && indexedSummary.data.lastAt != null
    ? [indexedSummary.data.firstAt, indexedSummary.data.lastAt].map(time => {
      const date = new Date(time)
      return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`
    }).join(' — ') : ''
  const reportConversations = useMemo(() => {
    const keyword = reportQuery.trim().toLocaleLowerCase()
    return list.filter((conversation) => {
      if (conversation.type === 'official') return false
      const matchesType = reportType === 'all' || conversation.type === reportType
      const matchesQuery = !keyword || `${conversation.name} ${conversation.preview}`.toLocaleLowerCase().includes(keyword)
      return matchesType && matchesQuery
    })
  }, [list, reportQuery, reportType])
  const reportConversation = reportConversations.find(conversation => conversation.id === reportConversationId) ?? reportConversations[0]
  const textModels = useMemo(() => modelConfigs.filter(config => config.kind === 'text'), [modelConfigs])
  const imageModels = useMemo(() => modelConfigs.filter(config => config.kind === 'image'), [modelConfigs])
  const configurableModels = useMemo(() => modelConfigs.filter(config => config.kind !== 'speech'), [modelConfigs])
  const voiceModelStateText = voiceModelStatus ? {
    missing: '未下载',
    downloading: '下载中',
    ready: '已下载',
    invalid: '需要重新下载',
    error: '下载失败',
    unsupported: '当前平台不支持',
  }[voiceModelStatus.state] : '检测中…'
  const voiceModelPercent = Math.round((voiceModelStatus?.progress ?? 0) * 100)
  const reportModel = textModels.find(config => config.id === reportModelId) ?? textModels.find(config => config.isDefault) ?? textModels[0]
  const reportImageModel = imageModels.find(config => config.id === reportImageModelId)
  const selectedReportScope = reportScope?.conversationId === reportConversation?.id ? reportScope : null
  const latestReportMessage = reportConversation?.messages.at(-1)
  const reportSnapshotKey = JSON.stringify([rootDir, reportConversation?.id, reportSelectionVersion, selectedReportScope?.items, latestReportMessage?.id, latestReportMessage?.createdAt, selectedReportScope ? undefined : reportStartDate, selectedReportScope ? undefined : reportEndDate])
  const reportData = useMemo<ReportMessagesResult | null>(() => {
    if (!reportSnapshot || reportSnapshot.key !== reportSnapshotKey || !reportConversation || !reportStartDate || !reportEndDate || reportStartDate > reportEndDate) return null
    try {
      return filterReportMessages(reportSnapshot.data.messages, { conversationId: reportConversation.id, startDate: reportStartDate, endDate: reportEndDate, contentTypes: reportContentTypes.filter(type => reportContent[type.id]).map(type => type.id) })
    } catch { return null }
  }, [reportSnapshot, reportSnapshotKey, reportConversation?.id, reportStartDate, reportEndDate, reportContent])
  const reportMembers = useMemo(() => {
    const members = new Map<string, { key: string; name: string; count: number }>()
    for (const message of reportData?.messages ?? []) {
      if (message.messageType === 10000) continue
      const key = reportMemberKey(message)
      if (!key) continue
      const member = members.get(key) ?? { key, name: reportMemberName(message), count: 0 }
      member.count += message.count ?? 1
      members.set(key, member)
    }
    return [...members.values()].sort((a, b) => b.count - a.count)
  }, [reportData])
  const reportTargetMember = reportConversation?.type === 'group' ? reportMembers.find(member => member.key === reportTargetKey) : undefined
  const reportContentCounts = reportData?.counts ?? { message: 0, voice: 0, image: 0, video: 0 }
  const reportSelectedCount = reportContentTypes.reduce((total, item) => total + (reportContent[item.id] ? reportContentCounts[item.id] : 0), 0)
  const personalReport = reportConversation?.type === 'group' && !!reportTargetKey
  const availableReportTemplates = defaultReportTemplates
  const availableReportStyles = reportStyles.filter(style => !style.builtin || (style.scope === 'personal') === personalReport)
  const selectedReportStyle = availableReportStyles.find(style => style.id === reportStyle) ?? availableReportStyles[0]
  const reportTemplate = availableReportTemplates.find(template => template.id === reportTemplateId) ?? availableReportTemplates[0]
  useEffect(() => {
    setReportTemplateId(defaultReportTemplates[0].id)
    setReportStyle(personalReport ? 'personal-concise' : 'default')
    setReportStyleEditing(false)
  }, [personalReport])

  function notify(message: string) {
    setToast(message)
  }

  useEffect(() => {
    const conversationId = reportConversation?.id
    if (!entered || view !== 'summary' || summaryPanel !== 'generate' || !conversationId) return
    if (!reportStartDate || !reportEndDate || reportStartDate > reportEndDate) {
      setReportSnapshot(null)
      setReportDataLoading(false)
      setReportDataError('请选择有效的开始和结束日期')
      return
    }
    let active = true
    let cached = reportLoadCache.current
    if (!cached || cached.key !== reportSnapshotKey) {
      cached = { key: reportSnapshotKey, promise: window.wetrace.loadReportConversation({ root: rootDir ?? undefined, conversationId, selectedMessages: selectedReportScope?.items, ...(!selectedReportScope ? { startDate: reportStartDate, endDate: reportEndDate } : {}) }) }
      reportLoadCache.current = cached
    }
    const load = cached
    if (load.data) {
      setReportSnapshot({ key: load.key, data: load.data })
      setReportDataLoading(false)
      setReportDataError('')
      return
    }
    setReportSnapshot(null)
    setReportDataLoading(true)
    setReportDataError('')
    void load.promise.then(response => {
      if (response.ok) {
        load.data = response.data
        if (active) setReportSnapshot({ key: load.key, data: response.data })
      } else {
        if (reportLoadCache.current === load) reportLoadCache.current = null
        if (active) setReportDataError(response.error)
      }
    }).catch(error => {
      if (reportLoadCache.current === load) reportLoadCache.current = null
      if (active) setReportDataError(error instanceof Error ? error.message : '读取完整会话记录失败')
    }).finally(() => { if (active) setReportDataLoading(false) })
    return () => { active = false }
  }, [entered, view, summaryPanel, reportConversation?.id, rootDir, reportSnapshotKey])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2800)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    void window.wetrace?.getAppInfo().then((info) => { setAppVersion(info.version); setAppPlatform(info.platform) }).catch(() => undefined)
    void window.wetrace?.listWechatAccounts(rootDir ?? undefined).then(setAccounts).catch(() => undefined)
    void window.wetrace?.getCacheSize().then(setCacheBytes).catch(() => undefined)
  }, [])

  useEffect(() => {
    void window.wetrace.listReportStyles().then(setReportStyles).catch(() => notify('读取自定义报告风格失败'))
  }, [])

  useEffect(() => {
    void window.wetrace?.listModelConfigs().then(setModelConfigs).catch(() => notify('读取模型配置失败'))
  }, [])

  useEffect(() => {
    let active = true
    void window.wetrace.getVoiceModelStatus()
      .then(status => { if (active) setVoiceModelStatus(status) })
      .catch(() => { if (active) notify('读取语音模型状态失败') })
    const unsubscribe = window.wetrace.onVoiceModelProgress(setVoiceModelStatus)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  function editModel(config: ModelConfig) {
    setEditingModelId(current => current === config.id ? null : config.id)
  }

  function applyModelPreset(nextProvider: string, nextFormat: ApiFormat, nextKind: ModelKind) {
    const preset = modelPreset(nextProvider, nextFormat, nextKind)
    setProvider(nextProvider)
    setApiFormat(nextFormat)
    setModelKind(nextKind)
    setModelSource('remote')
    setBaseUrl(preset.baseUrl)
    setModelName(preset.model)
    if (nextProvider !== provider) setApiKey('')
  }

  function changeModelSource(nextSource: ModelSource) {
    setModelSource(nextSource)
    if (nextSource === 'local') {
      setProvider('本地模型')
      setApiFormat('openai')
      setBaseUrl('')
      setApiKey('')
    } else if (provider === '本地模型') {
      setProvider('自定义')
    }
  }

  function newModel(kind: ModelKind = 'text', source: ModelSource = 'remote') {
    setEditingModelId(null)
    setModelConfigName('')
    setLocalModelPath('')
    applyModelPreset('DeepSeek', 'openai', kind)
    if (source === 'local') changeModelSource('local')
    setApiKey('')
  }

  async function saveModel(input: SaveModelConfigInput) {
    if (savingModel) return
    if (input.source !== 'local' && !input.id && !input.apiKey?.trim()) {
      notify('请输入 API Key')
      return
    }
    setSavingModel(true)
    try {
      const saved = await window.wetrace.saveModelConfig(input)
      setModelConfigs(current => input.id
        ? current.map(item => item.id === saved.id ? saved : item)
        : [...current, saved])
      if (input.id) setEditingModelId(null)
      else newModel(input.kind, input.source)
      notify('模型配置已保存到本机')
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存模型配置失败')
    } finally {
      setSavingModel(false)
    }
  }

  async function testModel(input: SaveModelConfigInput, requestId = input.id ?? 'form') {
    if (testingModelId) return
    setTestingModelId(requestId)
    try {
      const result = await window.wetrace.testModelConfig(input)
      notify(input.source === 'local' ? '本地模型目录检测通过' : `模型连接成功，响应耗时 ${result.latencyMs} ms`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '模型测试失败')
    } finally {
      setTestingModelId(null)
    }
  }

  async function setDefaultModel(config: ModelConfig) {
    if (config.isDefault || savingModel) return
    setSavingModel(true)
    try {
      setModelConfigs(await window.wetrace.setDefaultModelConfig(config.id))
      if (config.kind === 'text') setReportModelId('')
      notify(`已将“${config.name || config.model}”设为默认模型`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '设置默认模型失败')
    } finally {
      setSavingModel(false)
    }
  }

  async function removeModel(config: ModelConfig) {
    if (!window.confirm(`删除模型配置“${config.name || config.model}”？`)) return
    try {
      setModelConfigs(await window.wetrace.deleteModelConfig(config.id))
      if (editingModelId === config.id) setEditingModelId(null)
      notify('模型配置已删除')
    } catch (error) {
      notify(error instanceof Error ? error.message : '删除模型配置失败')
    }
  }

  async function downloadVoiceModel() {
    if (voiceModelBusy || !voiceModelStatus || voiceModelStatus.state === 'downloading' || !voiceModelStatus.supported) return
    setVoiceModelBusy(true)
    try {
      const result = await window.wetrace.downloadVoiceModel()
      setVoiceModelStatus(result.status)
      notify(result.success ? '模型下载并校验完成' : result.error ?? '模型下载失败')
    } catch (error) {
      notify(error instanceof Error ? error.message : '模型下载失败')
    } finally {
      setVoiceModelBusy(false)
    }
  }

  async function cancelVoiceModelDownload() {
    try {
      const cancelled = await window.wetrace.cancelVoiceModelDownload()
      if (!cancelled) notify('当前没有正在进行的模型下载')
    } catch (error) {
      notify(error instanceof Error ? error.message : '取消下载失败')
    }
  }

  async function refreshVoiceModel() {
    if (voiceModelBusy || voiceModelStatus?.state === 'downloading') return
    setVoiceModelBusy(true)
    try {
      const status = await window.wetrace.getVoiceModelStatus()
      setVoiceModelStatus(status)
      notify(status.state === 'ready' ? '模型文件校验通过' : status.error ?? '模型尚未下载')
    } catch (error) {
      notify(error instanceof Error ? error.message : '模型检测失败')
    } finally {
      setVoiceModelBusy(false)
    }
  }

  async function openDownloadedVoiceModelDirectory() {
    try {
      await window.wetrace.openVoiceModelDirectory()
    } catch (error) {
      notify(error instanceof Error ? error.message : '无法打开模型目录')
    }
  }

  async function removeDownloadedVoiceModel() {
    if (!voiceModelStatus || voiceModelBusy || voiceModelStatus.state === 'downloading') return
    if (!window.confirm('确定删除 SenseVoice Small INT8 的模型文件？此操作不可恢复。')) return
    setVoiceModelBusy(true)
    try {
      setVoiceModelStatus(await window.wetrace.removeVoiceModel())
      notify('模型文件已删除')
    } catch (error) {
      notify(error instanceof Error ? error.message : '删除模型文件失败')
    } finally {
      setVoiceModelBusy(false)
    }
  }

  useEffect(() => {
    void window.wetrace
      ?.detectWechat(rootDir ?? undefined)
      .then((result) => {
        setDetected(result)
        if (!result.hasKey || startupSyncStarted.current) return
        startupSyncStarted.current = true
        setLoginStep(3)
        void doSync(rootDir ?? undefined)
      })
      .catch(() => undefined)
    void window.wetrace?.getKeyStatus(rootDir ?? undefined).then(setKeyStatus).catch(() => undefined)
  }, [])

  const reportConfigActive = view === 'summary' && summaryPanel === 'generate'
  useEffect(() => {
    if (!entered || reportConfigActive) return
    const timer = window.setInterval(() => void doSync(rootDir ?? undefined, true), 20_000)
    return () => window.clearInterval(timer)
  }, [entered, rootDir, reportConfigActive])

  useEffect(() => {
    const accountRoot = real?.account.root
    if (!entered || !accountRoot || reportConfigActive) return
    let debounce: number | undefined
    const unsubscribe = window.wetrace.onDatabaseChanged((changedRoot) => {
      if (changedRoot !== accountRoot) return
      // Capture the first visible state before a quick recall can replace/delete it.
      void doSync(accountRoot, true)
      window.clearTimeout(debounce)
      // WAL notifications can precede commit; verify once more after the burst settles.
      debounce = window.setTimeout(() => void doSync(accountRoot, true), 150)
    })
    void window.wetrace.watchWechatAccount(accountRoot).catch(() => undefined)
    return () => {
      window.clearTimeout(debounce)
      unsubscribe()
      void window.wetrace.unwatchWechatAccount().catch(() => undefined)
    }
  }, [entered, real?.account.root, reportConfigActive])


  async function refreshCacheStats() {
    setMediaCacheBusy(true)
    setMediaCacheError('')
    try {
      const [bytes, stats] = await Promise.all([window.wetrace.getCacheSize(), window.wetrace.getMediaCacheStats()])
      setCacheBytes(bytes)
      setMediaCacheStats(stats)
    } catch { setMediaCacheError('缓存统计读取失败，请刷新重试') }
    finally { setMediaCacheBusy(false) }
  }

  useEffect(() => {
    if (view !== 'settings' || settingsPanel !== 'cache') return
    void refreshCacheStats()
  }, [view, settingsPanel])

  // 首次检测完成后，从已完成的步骤开始，避免每次都从第 1 步走。
  useEffect(() => {
    if (stepInited.current || !keyStatus) return
    stepInited.current = true
    if (detected?.hasKey) setLoginStep(3)
    else if (keyStatus.sipEnabled === false) setLoginStep(1)
  }, [keyStatus, detected])

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (!entered || !(event.metaKey || event.ctrlKey)) return
      if (event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        setView('messages')
        window.setTimeout(() => searchRef.current?.focus(), 0)
      }
      if (event.key === ',') {
        event.preventDefault()
        setView('settings')
      }
    }
    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [entered])

  useLayoutEffect(() => {
    if (view !== 'messages' || !entered) return
    const element = chatScrollRef.current, content = chatContentRef.current
    if (!element || !content) return
    followChatBottom.current = true
    historyAnchor.current = null
    const scrollToLatest = () => {
      const anchor = historyAnchor.current
      if (anchor?.key === currentConversationKey.current && !followChatBottom.current) {
        const row = Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).find(row => row.dataset.messageId === anchor.id)
        if (row) {
          element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.offset
          previousChatScrollTop.current = element.scrollTop
        }
      }
      if (followChatBottom.current && !historyRequest.current) element.scrollTop = element.scrollHeight
    }
    const onScroll = () => {
      followChatBottom.current = element.scrollHeight - element.clientHeight - element.scrollTop <= 48
    }
    scrollToLatest()
    previousChatScrollTop.current = element.scrollTop
    element.addEventListener('scroll', onScroll, { passive: true })
    // Images and deferred message layout can change height after the message update.
    const observer = new ResizeObserver(scrollToLatest)
    observer.observe(content)
    observer.observe(element)
    const frame = requestAnimationFrame(scrollToLatest)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); element.removeEventListener('scroll', onScroll) }
  }, [view, entered, rootDir, selected?.id])

  useLayoutEffect(() => {
    const element = chatScrollRef.current
    const anchor = historyAnchor.current
    if (element && anchor?.key === currentConversationKey.current) {
      const row = Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).find(row => row.dataset.messageId === anchor.id)
      element.scrollTop = row ? element.scrollTop + row.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.offset : anchor.top + element.scrollHeight - anchor.height
      previousChatScrollTop.current = element.scrollTop
    }
  }, [selected?.messages])

  useLayoutEffect(() => {
    const element = chatScrollRef.current
    if (view === 'messages' && element && followChatBottom.current && !historyRequest.current) element.scrollTop = element.scrollHeight
  }, [view, selected?.messages])

  async function selectDirectory() {
    try {
      const directory = await window.wetrace?.selectDirectory()
      if (!directory) return
      const found = await window.wetrace.listWechatAccounts(directory)
      if (!found.length) return notify('该目录下没有可用的微信账号数据库')
      setAccounts(found)
      await switchAccount(found[0].root)
    } catch {
      notify('暂时无法打开系统目录选择器')
    }
  }

  async function switchAccount(accountRoot: string) {
    if (syncing) return
    syncGeneration.current += 1
    activeRootRef.current = accountRoot
    setRootDir(accountRoot)
    window.localStorage.setItem('wetrace:selected-account-root', accountRoot)
    setReal(null)
    setAiLaunch(undefined)
    setSelectedId('')
    setEntered(false)
    setProfileOpen(false)
    setAutoSyncError('')
    try {
      const [result, status, found] = await Promise.all([
        window.wetrace.detectWechat(accountRoot),
        window.wetrace.getKeyStatus(accountRoot),
        window.wetrace.listWechatAccounts(accountRoot),
      ])
      setDetected(result)
      setKeyStatus(status)
      setAccounts(found)
      setLoginStep(result.hasKey ? 3 : status.sipEnabled ? 0 : 1)
      if (result.hasKey) await doSync(accountRoot)
      else notify('已切换账号，请先获取该账号的数据库密钥')
    } catch (error) {
      notify(error instanceof Error ? error.message : '切换账号失败')
    }
  }

  function disconnectAccount() {
    syncGeneration.current += 1
    setEntered(false)
    setReal(null)
    setAiLaunch(undefined)
    setSelectedId('')
    setProfileOpen(false)
    setLoginStep(detected?.hasKey ? 3 : 1)
  }

  async function openIndexedSearchMatch(match: ChatIndexSearchMatch) {
    const root = real?.account.root ?? rootDir ?? undefined
    const generation = syncGeneration.current
    const response = await window.wetrace.getIndexedConversation({ root, conversationId: match.conversationId, at: match.createdAt })
    if (!response.ok) throw new Error(response.error)
    if (generation !== syncGeneration.current) return
    if (root) indexedConversationRef.current = { root, conversation: response.conversation, at: match.createdAt }
    setReal(current => current && current.account.root === root ? { ...current, conversations: [response.conversation, ...current.conversations.filter(item => item.id !== response.conversation.id)] } : current)
    setQuery('')
    setType('all')
    setSelectedId(response.conversation.id)
    setHistoryEndKey(null)
  }

  async function refreshCurrentConversation() {
    if (!selected || conversationRefreshInFlight.current || historyRequest.current) return
    const root = real?.account.root ?? rootDir ?? undefined
    if (!root) { notify('请先连接微信账号'); return }
    const requestKey = conversationSummaryKey
    const generation = syncGeneration.current
    conversationRefreshInFlight.current = true
    setRefreshingConversation(true)
    try {
      const response = await window.wetrace.getIndexedConversation({ root, conversationId: selected.id, limit: 60, refresh: true })
      if (generation !== syncGeneration.current || currentConversationKey.current !== requestKey) return
      if (!response.ok) throw new Error(response.error)
      followChatBottom.current = true
      const conversation = preserveConversationAvatars({ ...selected, ...response.conversation }, selected)
      indexedConversationRef.current = { root, conversation }
      setReal(current => current?.account.root === root ? { ...current, conversations: [conversation, ...current.conversations.filter(item => item.id !== conversation.id)] } : current)
      setHistoryEndKey(null)
      setSummaryRetry(value => value + 1)
      setAutoSyncError('')
      requestAnimationFrame(() => {
        if (currentConversationKey.current === requestKey && chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
      })
      notify('已刷新到最新本地聊天记录')
    } catch (error) {
      if (generation === syncGeneration.current && currentConversationKey.current === requestKey) notify(error instanceof Error ? error.message : '刷新聊天记录失败，请重试')
    } finally {
      conversationRefreshInFlight.current = false
      setRefreshingConversation(false)
    }
  }

  async function loadEarlierMessages() {
    if (!selected || historyRequest.current || conversationRefreshInFlight.current || historyEndKey === conversationSummaryKey || indexedSummary?.data && selected.messages.length >= indexedSummary.data.total) return
    historyRequest.current = true
    followChatBottom.current = false
    setLoadingHistory(true)
    const requestKey = conversationSummaryKey
    const root = real?.account.root ?? rootDir ?? undefined
    const generation = syncGeneration.current
    const historical = indexedConversationRef.current
    const at = historical && historical.root === root && historical.conversation.id === selected.id ? historical.at : undefined
    const element = chatScrollRef.current
    try {
      const response = await window.wetrace.getIndexedConversation({ root, conversationId: selected.id, at, limit: selected.messages.length + 60 })
      if (generation !== syncGeneration.current || currentConversationKey.current !== requestKey) return
      if (!response.ok) throw new Error(response.error)
      const height = element?.scrollHeight ?? 0
      const top = element?.scrollTop ?? 0
      const row = element && Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).find(row => row.getBoundingClientRect().bottom > element.getBoundingClientRect().top)
      historyAnchor.current = { key: requestKey, id: row?.dataset.messageId, offset: row && element ? row.getBoundingClientRect().top - element.getBoundingClientRect().top : 0, top, height }
      const conversation = preserveConversationAvatars({ ...selected, ...response.conversation }, selected)
      if (root) indexedConversationRef.current = { root, conversation, at }
      setReal(current => current && current.account.root === root ? { ...current, conversations: current.conversations.map(item => item.id === conversation.id ? conversation : item) } : current)
      if (conversation.messages.length < selected.messages.length + 60) setHistoryEndKey(requestKey)
    } catch (error) {
      if (currentConversationKey.current === requestKey) notify(error instanceof Error ? error.message : '加载历史消息失败')
    } finally {
      historyRequest.current = false
      setLoadingHistory(false)
    }
  }

  function applySync(data: SyncResult, preserveSelection = false) {
    if (real?.account.root === data.account.root) {
      const previous = new Map(real.conversations.map(conversation => [conversation.id, conversation]))
      data = { ...data, account: { ...data.account, avatar: data.account.avatar || real.account.avatar },
        conversations: data.conversations.map(conversation => preserveConversationAvatars(conversation, previous.get(conversation.id))) }
    }
    if (!data.conversations.length) {
      setSyncError('没有读取到可用的会话，请确认微信已登录并同步过消息。')
      setSyncMessage('')
      return
    }
    const historical = indexedConversationRef.current
    if (preserveSelection && historical?.root === data.account.root && JSON.stringify([historical.root, historical.conversation.id]) === currentConversationKey.current) {
      const latest = data.conversations.find(item => item.id === historical.conversation.id)
      let conversation = historical.conversation
      if (historical.at === undefined && latest) {
        const messages = new Map(conversation.messages.map(message => [`${message.createdAt}:${message.id}`, message]))
        for (const message of latest.messages) messages.set(`${message.createdAt}:${message.id}`, message)
        conversation = { ...latest, messages: [...messages.values()].sort((a, b) => a.createdAt - b.createdAt) }
        indexedConversationRef.current = { ...historical, conversation }
      }
      data = { ...data, conversations: [conversation, ...data.conversations.filter(item => item.id !== conversation.id)] }
    }
    setReal(data)
    setSelectedId((current) => preserveSelection && data.conversations.some((item) => item.id === current)
      ? current
      : (data.conversations.find(item => item.type === type)?.id ?? data.conversations[0].id))
    setSyncMessage(`已读取 ${data.conversations.length} 个会话，共 ${data.messageTotal.toLocaleString('en-US')} 条消息`)
    setEntered(true)
  }

  // 重新检测 SIP、密钥与微信进程，用于刷新步骤完成状态。
  async function refreshStatus() {
    if (refreshing) return
    setRefreshing(true)
    try {
      const [status, info] = await Promise.all([
        window.wetrace.getKeyStatus(rootDir ?? undefined),
        window.wetrace.detectWechat(rootDir ?? undefined),
      ])
      setKeyStatus(status)
      setDetected(info)
    } catch {
      notify('状态检测失败，请稍后重试')
    } finally {
      setRefreshing(false)
    }
  }

  // 附加监听：先确认 SIP 已关闭、微信停在登录页，再等待捕获密钥。
  async function startKeyCapture() {
    if (syncing) return
    setKeyError('')
    try {
      const status = await window.wetrace.getKeyStatus(rootDir ?? undefined)
      setKeyStatus(status)
      const problem = status.sipEnabled
        ? 'SIP 仍处于开启，请先回到第 1 步关闭。'
        : !status.wechatRunning
          ? '请先打开微信，并停留在未登录页面。'
          : status.wechatLoggedIn
            ? '请先在微信中退出账号，停留在未登录页面，再开始监听。'
            : ''
      if (problem) {
        setKeyError(problem)
        if (entered) notify(problem)
        return
      }
      await captureKey()
    } catch {
      setKeyError('无法检查系统权限，请稍后重试')
    }
  }

  async function captureKey() {
    setKeyError('')
    setCaptureStage('listening')
    const unsubscribe = window.wetrace.onCaptureReady(() => setCaptureStage('ready'))
    try {
      const result = await window.wetrace.fetchKey(rootDir ?? undefined)
      if (!result.ok) {
        setKeyError(result.error === 'SIP_REQUIRED' ? 'SIP 仍处于开启，请先回到第 1 步关闭。' : result.error)
        setCaptureStage('idle')
        return
      }
      const refreshed = await window.wetrace.detectWechat(rootDir ?? undefined)
      setDetected(refreshed)
      setKeyStatus((prev) => (prev ? { ...prev, hasKey: true } : prev))
      setCaptureStage('idle')
      setLoginStep(3)
      notify('数据库密钥已获取')
    } catch {
      setKeyError('获取密钥失败，请重试')
      setCaptureStage('idle')
    } finally {
      unsubscribe()
    }
  }

  async function doSync(root = rootDir ?? undefined, silent = false) {
    const directoryAtStart = activeRootRef.current
    const accountAtStart = activeAccountRootRef.current
    if (root && accountAtStart && root !== directoryAtStart && root !== accountAtStart) return
    const syncRoot = root ?? accountAtStart ?? 'default'
    const generation = syncGeneration.current
    if (syncInFlightRoots.current.has(syncRoot)) {
      if (silent) syncAgainRoots.current.add(syncRoot)
      return
    }
    syncInFlightRoots.current.add(syncRoot)
    if (!silent) {
      setSyncing(true)
      setSyncError('')
      setSyncMessage('正在解密本地数据库并读取会话…')
    }
    try {
      const response = await window.wetrace.syncWechat(root)
      if (generation !== syncGeneration.current || directoryAtStart !== activeRootRef.current || accountAtStart !== activeAccountRootRef.current) return
      if (!response.ok) {
        if (silent) setAutoSyncError(response.error)
        else {
          setSyncError(response.error)
          setSyncMessage('')
        }
        return
      }
      setAutoSyncError('')
      setSyncError('')
      if (silent) startTransition(() => applySync(response.data, true))
      else applySync(response.data)
    } catch {
      if (silent) setAutoSyncError('自动刷新失败，请检查微信状态')
      else {
        setSyncError('同步失败，请确认微信已登录且数据库可读')
        setSyncMessage('')
      }
    } finally {
      syncInFlightRoots.current.delete(syncRoot)
      const again = syncAgainRoots.current.delete(syncRoot)
      if (!silent) setSyncing(false)
      if (again && generation === syncGeneration.current && directoryAtStart === activeRootRef.current) void doSync(root, true)
    }
  }

  async function runSync() {
    if (syncing) return
    if (!detected?.hasKey) {
      notify('请先获取数据库密钥')
      return
    }
    await doSync()
  }

  function openSettings(panel: SettingsPanel) {
    setSettingsPanel(panel)
    setView('settings')
  }

  function selectReportDatePreset(preset: ReportDatePreset) {
    setReportDatePreset(preset)
    if (preset === 'custom') return
    const today = toDateInput(new Date())
    const end = preset === 'yesterday' ? daysAgo(1) : today
    setReportStartDate(preset === 'week' ? daysAgo(6) : end)
    setReportEndDate(end)
  }

  function openSelectedReport() {
    if (!selected || !chatPicks.length) return notify('请先勾选需要总结的消息')
    try {
      const messages = selectReportMessages(selected.messages, chatPicks)
      const times = messages.map(message => message.createdAt)
      setReportStartDate(reportSelectionDate(Math.min(...times)))
      setReportEndDate(reportSelectionDate(Math.max(...times)))
      setReportDatePreset('custom')
      setReportConversationId(selected.id)
      setReportQuery('')
      setReportType('all')
      setReportTargetKey('')
      setReportScope({ conversationId: selected.id, items: chatPicks })
      setReportSelectionVersion(version => version + 1)
      setReportContent({ message: true, voice: messages.some(message => message.messageType === 34), image: messages.some(message => message.messageType === 3), video: messages.some(message => message.messageType === 43) })
      setSummaryPanel('generate')
      setView('summary')
    } catch (error) { notify(error instanceof Error ? error.message : '所选消息不可用') }
  }

  function openReportGenerator(templateId = reportTemplateId) {
    setReportTemplateId(templateId)
    setSummaryPanel('generate')
    setView('summary')
  }

  function openCurrentConversationReport() {
    if (!selected) return
    setReportScope(null)
    setReportConversationId(selected.id)
    setReportQuery('')
    setReportType('all')
    setReportTargetKey('')
    setReportSelectionVersion(version => version + 1)
    setChatPicking(false)
    setChatPicks([])
    openReportGenerator()
  }

  async function copyGeneratedReportImage() {
    if (!generatedReport || copyingReportImage) return
    setCopyingReportImage(true)
    try {
      await window.wetrace.copyReportImages(generatedReport.pngPaths)
      notify('图片已复制')
    } catch (error) { notify(error instanceof Error ? error.message : '复制图片失败') }
    finally { setCopyingReportImage(false) }
  }

  function editReportStyle(style?: ReportWritingStyle) {
    setReportStyleEditingId(style?.builtin ? undefined : style?.id)
    setReportStyleName(style?.builtin ? `${style.name}（自定义）` : style?.name ?? '')
    setReportStyleDraft(style?.prompt ?? '')
    setReportStyleEditing(true)
  }

  async function saveWritingStyle() {
    if (reportStyleSaving) return
    setReportStyleSaving(true)
    try {
      const saved = await window.wetrace.saveReportStyle({ id: reportStyleEditingId, name: reportStyleName, prompt: reportStyleDraft })
      setReportStyles(current => [...current.filter(style => style.id !== saved.id), saved])
      setReportStyle(saved.id)
      setReportStyleEditing(false)
      notify('自定义风格已保存，可在下拉列表中重复使用')
    } catch (error) { notify(error instanceof Error ? error.message : '保存风格失败') }
    finally { setReportStyleSaving(false) }
  }

  async function deleteWritingStyle() {
    if (!selectedReportStyle || selectedReportStyle.builtin || reportStyleSaving) return
    setReportStyleSaving(true)
    try {
      setReportStyles(await window.wetrace.deleteReportStyle(selectedReportStyle.id))
      setReportStyle(personalReport ? 'personal-concise' : 'default')
      setReportStyleEditing(false)
      notify('自定义风格已删除')
    } catch (error) { notify(error instanceof Error ? error.message : '删除风格失败') }
    finally { setReportStyleSaving(false) }
  }

  async function generateReport() {
    if (reportRunning) return
    if (reportStyleEditing) return notify('请先保存或取消风格编辑')
    if (!selectedReportStyle) return notify('请选择有效的报告风格')
    if (reportConversation?.type === 'group' && reportTargetKey && !reportTargetMember) return notify('所选成员在当前范围没有消息，请重新选择总结对象')
    if (!reportConversation) return notify('请先选择一个群聊或联系人')
    if (!reportStartDate || !reportEndDate || reportStartDate > reportEndDate) return notify('请选择有效的开始和结束日期')
    if (!Object.values(reportContent).some(Boolean)) return notify('请至少选择一种内容类型')
    if (!reportModel) return notify('请先在设置中配置基础语言模型')
    if (reportContent.image) {
      try { imageConcurrency(Number(reportImageConcurrency)) }
      catch (error) { return notify(error instanceof Error ? error.message : '图片线程数无效') }
    }
    if (reportContent.image && !reportImageModel) return notify('已勾选图片内容，请选择图片理解模型，或取消勾选图片')
    if (reportDataLoading) return notify('正在加载会话记录，请稍候')
    if (reportDataError) return notify(`会话记录读取失败：${reportDataError}`)
    const selectedTypes = reportContentTypes.filter(item => reportContent[item.id]).map(item => item.id)
    if (!reportData || reportData.conversationId !== reportConversation.id || reportData.startDate !== reportStartDate || reportData.endDate !== reportEndDate || reportData.contentTypes.join(',') !== selectedTypes.join(',')) {
      return notify('会话记录尚未加载完成，请稍候')
    }
    if (!reportData.messages.length) return notify('当前筛选条件下没有可生成报告的记录')
    if (reportContent.voice && voiceModelStatus?.state !== 'ready') return notify('请先在设置 → 语音转文字中下载离线模型')
    const requestId = crypto.randomUUID()
    reportRequestId.current = requestId
    setReportTask({
      conversationId: reportConversation.id, conversationName: reportConversation.name, avatar: reportConversation.avatar,
      target: reportTargetMember?.name ?? (reportConversation.type === 'group' ? '整个群聊' : '双方对话'),
      startDate: reportStartDate, endDate: reportEndDate, messageCount: reportData.messages.length,
      style: selectedReportStyle.name, model: reportModel.name || reportModel.model,
      imageModel: reportContent.image ? reportImageModel?.name || reportImageModel?.model : undefined,
      concurrency: reportContent.image ? Number(reportImageConcurrency) : undefined,
      selectionOnly: !!selectedReportScope, startedAt: Date.now(),
    })
    setReportRunning(true)
    setGeneratedReport(null)
    setReportProgress({ requestId, stage: 'read', percent: 0, detail: '正在准备生成报告' })
    try {
      const response = await window.wetrace.generateReport({ requestId, snapshotId: reportSnapshot!.data.snapshotId, root: rootDir ?? undefined, conversationId: reportConversation.id, conversationName: reportConversation.name, targetMember: reportTargetMember ? { key: reportTargetMember.key, name: reportTargetMember.name } : undefined, startDate: reportStartDate, endDate: reportEndDate, contentTypes: selectedTypes, modelId: reportModel.id, imageModelId: reportImageModel?.id, imageConcurrency: reportContent.image ? Number(reportImageConcurrency) : undefined, templateId: reportTemplate.id, style: selectedReportStyle.id, format: reportFormat })
      if (!response.ok) {
        setReportProgress(current => ({ requestId, ...current, stage: 'error', percent: current?.percent ?? 0, detail: response.error, advice: response.advice, diagnosticPath: response.diagnosticPath }))
        throw new Error(response.error)
      }
      setGeneratedReport(response.data)
      notify('报告已生成并保存到文稿目录')
    } catch (error) {
      const detail = error instanceof Error ? error.message : '报告生成失败'
      setReportProgress(current => current?.stage === 'error' ? current : { requestId, stage: 'error', percent: current?.percent ?? 0, media: current?.media, detail })
      notify(detail)
    } finally { setReportRunning(false) }
  }

  if (!entered) {
    return (
      <>
        <LoginFlow
          detected={detected}
          status={keyStatus}
          step={loginStep}
          captureStage={captureStage}
          syncing={syncing}
          refreshing={refreshing}
          keyError={keyError}
          message={syncMessage}
          error={syncError}
          onStep={setLoginStep}
          onRefresh={() => void refreshStatus()}
          onOpenSipGuide={() => setSipGuide(true)}
          onStartListening={() => void startKeyCapture()}
          onSync={() => void doSync()}
        />
        <SipGuide
          open={sipGuide}
          onClose={() => setSipGuide(false)}
          onCopied={() => notify('已复制命令')}
          onRetry={() => {
            setSipGuide(false)
            void refreshStatus()
          }}
        />
        {toast && <Alert className="toast" role="status" type="info" showIcon title={toast} />}
      </>
    )
  }

  return (
    <div className="app">
      <aside className="rail">
        <div className="app-brand" aria-label="WeTrace"><div className="logo" aria-hidden="true">W</div><span>WeTrace</span></div>
        {([
          { id: 'messages' as View, label: '消息', icon: MessageCircle },
          { id: 'ai' as View, label: 'AI 对话', icon: Sparkles },
          { id: 'monitor' as View, label: '群聊监控', icon: ShieldCheck },
          { id: 'send' as View, label: '定时发送', icon: MessageCircle },
          { id: 'summary' as View, label: '总结', icon: FileText },
          { id: 'settings' as View, label: '设置', icon: Settings2 },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            className={`rbtn${view === id ? ' on' : ''}`}
            aria-label={label}
            aria-pressed={view === id}
            onClick={() => setView(id)}
          >
            <Icon size={19} strokeWidth={1.7} />
            {id === 'messages' && <span className="dot" />}
            <span className="tip">{id === 'monitor' ? '监控' : label}</span>
          </button>
        ))}
        <div className="spacer" />
        <button
          type="button"
          ref={profileButton}
          className="rbtn account-profile-button"
          aria-label={`我的账号：${accountName}，${dataStatusText}`}
          aria-expanded={profileOpen}
          onClick={() => {
            setProfileOpen((open) => !open)
            void refreshStatus()
          }}
        >
          <span className="account-avatar-wrap">
            <ProfileAvatar name={accountName} avatar={account?.avatar} className="me" />
            <span className={`account-status-dot${dataHealthy ? ' healthy' : ''}`} role="img" aria-label={dataStatusText} title={dataStatusText} />
          </span><span className="tip"><SafeText>{accountName}</SafeText></span>
        </button>
        {profileOpen && (
          <div ref={profilePopover} className="profile-popover" role="dialog" aria-label="当前账号状态">
            <div className="profile-popover-head"><ProfileAvatar name={accountName} avatar={account?.avatar} className="me" /><div><b><SafeText>{accountName}</SafeText></b><span>{account?.wxid ?? '未连接微信'}</span></div></div>
            <div className="profile-popover-row"><span>数据库密钥</span><b>{detected?.hasKey ? '可用' : '未获取'}</b></div>
            <div className="profile-popover-row"><span>聊天记录</span><b>{autoSyncError ? '刷新失败' : real ? '可读取' : '未同步'}</b></div>
            {autoSyncError && <p className="profile-popover-error">{autoSyncError}</p>}
            <p className="profile-popover-note">{real ? `最近刷新 ${new Date(real.syncedAt).toLocaleTimeString('zh-CN')} · 监听变化并每 20 秒检查` : '进入消息页后自动刷新本地记录'}</p>
            <ActionButton type="button" className="btn sm" onClick={() => { setProfileOpen(false); openSettings('db') }}>账号与同步设置</ActionButton>
          </div>
        )}
      </aside>

      <div className="workspace">
        {real?.account.root && <ScheduledMessagesPanel key={'send-' + real.account.root} root={real.account.root} visible={view === 'send'} />}
        {real?.account.root && <GroupMonitor conversations={real.conversations} key={real.account.root} root={real.account.root} visible={view === 'monitor'} onStateChange={(root, state) => setMonitorData({ root, state })} />}
        <div style={{ display: view === 'ai' ? 'contents' : 'none' }}><AiChat key={real?.account.root ?? 'none'} root={real?.account.root} conversations={real?.conversations ?? []} models={modelConfigs} launch={aiLaunch} onSettings={() => openSettings('model')} /></div>
        {view === 'messages' && (
          <section className="view active" aria-label="消息">
            <div className="msg-layout">
              <div className="conv-col">
                <div className="conv-top">
                  <div className="row">
                    <h2>消息</h2>
                    <span className="sync">{autoSyncError ? '自动刷新失败' : real ? `${real.messageTotal.toLocaleString('en-US')} 条 · 自动同步` : '未同步'}</span>
                  </div>
                  {real?.monitorWarning && <Alert type="warning" showIcon title="部分本地缓存暂不可用" description={real.monitorWarning} />}
                  <label className="search">
                    <Search size={15} strokeWidth={1.8} />
                    <input
                      ref={searchRef}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="搜索联系人、群聊、聊天记录"
                      aria-label="搜索联系人、群聊、聊天记录"
                    />
                    <kbd>⌘K</kbd>
                  </label>
                  <div className="chips" aria-label="会话类型">
                    {([{ id: 'group', label: '群聊' }, { id: 'friend', label: '联系人' }, { id: 'official', label: '服务与公众号' }, { id: 'all', label: '全部' }] as const).map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className={`chip${type === item.id ? ' on' : ''}`}
                        aria-pressed={type === item.id}
                        onClick={() => setType(item.id)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="conv-list">
                  {query.trim() && <IndexedSearchResults root={real?.account.root ?? rootDir ?? undefined} keyword={query} onOpen={openIndexedSearchMatch} />}
                  {filteredConversations.map((conversation) => (
                    <button
                      type="button"
                      className={`conv${selected?.id === conversation.id ? ' on' : ''}`}
                      key={conversation.id}
                      onClick={() => setSelectedId(conversation.id)}
                    >
                      <ProfileAvatar
                        name={conversation.name}
                        avatar={conversation.avatar}
                        className={`av${conversation.type === 'group' ? ' grp' : ''}`}
                      >
                        {conversation.unread && <span className="badge">{conversation.unread}</span>}
                      </ProfileAvatar>
                      <div className="mid">
                        <div className="line1">
                          <span className="nm"><SafeText>{conversation.name}</SafeText>{conversation.memberCount && <span className="member-count"> ({conversation.memberCount})</span>}</span>
                          <span className="tm">{conversation.time}</span>
                        </div>
                        <div className="pv"><SafeText>{conversation.preview}</SafeText></div>
                      </div>
                    </button>
                  ))}
                  {filteredConversations.length === 0 && <div className="empty-search">没有匹配的会话或聊天记录</div>}
                </div>
              </div>

              <div className="chat-col">
                {analysisConversation && <ChatAnalysis key={`${rootDir}:${analysisConversation.id}`} conversation={analysisConversation} root={real?.account.root ?? rootDir ?? undefined} onClose={() => setAnalysisConversation(null)} />}
                {selected ? <>
                <div className="chat-head">
                  <ProfileAvatar name={selected.name} avatar={selected.avatar} className="av" />
                  <div>
                    <div className="nm chat-name"><SafeText>{selected.name}</SafeText><button type="button" className="icon-btn conversation-refresh" aria-label="刷新当前聊天记录" title={refreshingConversation ? '正在读取最新本地记录…' : '刷新本地记录并回到最新消息'} disabled={refreshingConversation || loadingHistory} onClick={() => void refreshCurrentConversation()}><RefreshCw size={13} className={refreshingConversation ? 'spin' : undefined} /></button></div>
                    <div className="meta">{indexedSummary?.data
                      ? <>本地记录 {indexedSummary.data.total.toLocaleString('en-US')} 条{indexedRange && ` · ${indexedRange}`}</>
                      : indexedSummary?.error ? <span title={indexedSummary.error}>记录总数读取失败 <button type="button" className="summary-retry" onClick={() => setSummaryRetry(value => value + 1)}>重试</button></span>
                      : '正在统计本地记录…'
                      }</div>
                  </div>
                  <div className="ops">
                    {selected.type !== 'official' && <ActionButton className="speech-entry" onClick={openCurrentConversationReport}><FileText size={14} />生成报告</ActionButton>}
                    <button type="button" className="speech-entry" disabled={!real?.account.root} title="关联当前会话，发送问题后按需查询聊天记录" onClick={() => {
                      setAiLaunch({ id: crypto.randomUUID(), root: real!.account.root, context: conversationAiContext(selected) })
                      setView('ai')
                    }}><Sparkles size={14} />问 AI</button>
                    <button type="button" className="speech-entry" aria-pressed={chatPicking} onClick={() => { setChatPicking(value => !value); setChatPicks([]) }}>选择消息生成报告</button>
                    <ActionButton className="speech-entry" onClick={() => setAnalysisConversation(selected)}>聊天分析</ActionButton>
                  </div>
                </div>

                <div className="chat-scroll" ref={chatScrollRef} onScroll={event => {
                  const element = event.currentTarget
                  if (element.scrollTop !== previousChatScrollTop.current) historyAnchor.current = null
                  const movingUp = element.scrollTop < previousChatScrollTop.current
                  previousChatScrollTop.current = element.scrollTop
                  if (movingUp && element.scrollTop <= 240) void loadEarlierMessages()
                }}>
                  <div className="chat-scroll-content" ref={chatContentRef}>
                  <div className="chat-history-control">{historyEndKey !== conversationSummaryKey && (!indexedSummary?.data || selected.messages.length < indexedSummary.data.total)
                    ? <span role="status">{loadingHistory ? '正在加载更早消息…' : '向上滚动查看更早消息'}</span>
                    : <span>没有更早的记录了</span>}</div>
                  {chatPicking ? <ReportMessagePicker key={`${rootDir}:${selected.id}`} conversation={selected} accountName={accountName} selected={chatPicks} onChange={setChatPicks} renderContent={message => <MessageContent message={message} root={real?.account.root} />} /> : <ChatMessages root={real?.account.root} conversation={selected} accountName={accountName} accountAvatar={account?.avatar} monitorRoom={monitorData?.root === real?.account.root ? monitorData?.state.rooms.find(room => room.id === selected.id) : undefined} />}
                  </div>
                </div>

                {chatPicking && <div className="report-selection-bar"><b>已选 {chatPicks.length} 条消息</b><span>只总结所选内容</span><ActionButton type="button" className="btn sm" onClick={() => { setChatPicking(false); setChatPicks([]) }}>取消</ActionButton><ActionButton type="button" className="btn sm primary" disabled={!chatPicks.length || reportRunning} onClick={openSelectedReport}>生成所选消息报告</ActionButton></div>}
                <div className="composer">
                  <div className="box">聊天记录只读 · 发送任务在独立入口管理</div>
                  <div className="hint"><span>{`${indexedSummary?.data ? `共 ${indexedSummary.data.total.toLocaleString('en-US')} 条本地记录 · ` : ''}已展示 ${selected.messages.length} 条`}</span><span>⌘K 搜索 · ⌘, 设置</span></div>
                </div>
                </> : <div className="empty-search">这个分组暂时没有会话</div>}
              </div>
            </div>
          </section>
        )}

        {view === 'summary' && (
          <section className="view active" aria-label="总结">
            {summaryPanel === 'home' && (
              <div className="page summary-page">
                <div className="page-head">
                  <div><h2>总结</h2><p>从本地聊天记录中整理重点，生成结构清晰、可回看原文的报告。</p></div>
                </div>
                <div className="summary-actions">
                  <button type="button" className="summary-action" onClick={() => openReportGenerator()}>
                    <span className="summary-action-icon"><FileText size={22} strokeWidth={1.7} /></span>
                    <span className="summary-action-copy"><b>生成报告</b><span>选择会话、时间、内容和模型，按需整理聊天重点。</span></span>
                    <ArrowRight size={18} />
                  </button>
                  <button type="button" className="summary-action" onClick={() => setSummaryPanel('templates')}>
                    <span className="summary-action-icon alt"><LayoutTemplate size={22} strokeWidth={1.7} /></span>
                    <span className="summary-action-copy"><b>报告模板</b><span>查看系统内置的视觉排版与展示效果。</span></span>
                    <ArrowRight size={18} />
                  </button>
                </div>
                <ReportHistory />
                <div className="guide-note">
                  <div className="ic"><ShieldCheck size={14} /></div>
                  <div><b>本地内容，按需分析：</b>只有生成报告时勾选的会话内容才会发送给你选择的模型服务；报告中的结论应保留原文依据。</div>
                </div>
              </div>
            )}

            {summaryPanel === 'templates' && (
              <div className="page summary-page">
                <div className="page-head">
                  <div><button type="button" className="page-back" onClick={() => setSummaryPanel('home')}><ArrowLeft size={14} />总结</button><h2>报告模板</h2><p>系统内置展示模板；模板决定排版，报告内容由风格控制。</p></div>
                  <ActionButton type="button" className="btn primary" onClick={() => openReportGenerator()}><FileText size={14} />生成报告</ActionButton>
                </div>
                <div className="template-list">
                  {defaultReportTemplates.map(template => (
                    <article className="template-list-item" key={template.id}>
                      <div className="template-list-copy">
                        <div className="template-list-title"><h3>{template.name}</h3><span className="template-badge">系统模板</span></div>
                        <p>{template.description}</p>
                        <div className="template-list-features">
                          {template.features.map(section => <span key={section}>{section}</span>)}
                        </div>
                      </div>
                      <ActionButton type="button" className="btn sm" onClick={() => setSummaryPanel('example')}>查看示例 <ArrowRight size={13} /></ActionButton>
                    </article>
                  ))}
                </div>
              </div>
            )}

            {summaryPanel === 'example' && (
              <div className="page summary-page report-example-page">
                <div className="page-head">
                  <div><button type="button" className="page-back" onClick={() => setSummaryPanel('templates')}><ArrowLeft size={14} />报告模板</button><h2>默认模板示例</h2><p>以下为模拟数据，展示报告的实际排版效果。</p></div>
                </div>
                <iframe className="report-example-frame" title="默认模板报告示例" src="./default-report-example.html" sandbox="" />
              </div>
            )}

            {summaryPanel === 'generate' && (
              <div className="msg-layout report-layout">
                <div className="conv-col">
                  <div className="conv-top">
                    <div className="row">
                      <div className="report-list-title"><button type="button" className="icon-btn" aria-label="返回总结" onClick={() => setSummaryPanel('home')}><ArrowLeft size={16} /></button><h2>选择会话</h2></div>
                      <span className="sync">{reportConversations.length} 个</span>
                    </div>
                    <label className="search">
                      <Search size={15} strokeWidth={1.8} />
                      <input value={reportQuery} onChange={event => setReportQuery(event.target.value)} placeholder="搜索群聊或联系人" aria-label="搜索报告会话" />
                    </label>
                    <div className="chips" aria-label="报告会话类型">
                      {([{ id: 'all', label: '全部' }, { id: 'group', label: '群聊' }, { id: 'friend', label: '联系人' }] as const).map(item => (
                        <button type="button" key={item.id} className={`chip${reportType === item.id ? ' on' : ''}`} aria-pressed={reportType === item.id} onClick={() => setReportType(item.id)}>{item.label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="conv-list">
                    {reportConversations.map(conversation => (
                      <button type="button" className={`conv${reportConversation?.id === conversation.id ? ' on' : ''}`} key={conversation.id} onClick={() => { setReportScope(null); setReportConversationId(conversation.id); setReportSelectionVersion(version => version + 1) }}>
                        <ProfileAvatar name={conversation.name} avatar={conversation.avatar} className={`av${conversation.type === 'group' ? ' grp' : ''}`} />
                        <div className="mid">
                          <div className="line1"><span className="nm"><SafeText>{conversation.name}</SafeText>{conversation.memberCount && <span className="member-count"> ({conversation.memberCount})</span>}</span><span className="tm">{reportRunning && reportTask?.conversationId === conversation.id ? <span className="report-conversation-running">生成中</span> : conversation.type === 'group' ? '群聊' : '联系人'}</span></div>
                          <div className="pv"><SafeText>{conversation.preview}</SafeText></div>
                        </div>
                      </button>
                    ))}
                    {reportConversations.length === 0 && <div className="empty-search">没有匹配的群聊或联系人</div>}
                  </div>
                </div>

                <div className="report-config">
                  <div className="report-config-inner">
                    <div className="report-config-head"><div><span>REPORT WORKSPACE</span><h2>报告配置</h2><p>选择会话与分析范围，右侧独立展示生成任务。</p></div><FileText size={24} strokeWidth={1.5} /></div>
                    {reportRunning && reportTask && <div className="report-editing-notice"><span className="report-task-dot" /><span>正在为 <b><SafeText>{reportTask.conversationName}</SafeText></b> 生成报告。这里可以继续调整配置，当前任务按提交时的设置处理。</span></div>}
                    {reportConversation ? <div className="report-selected"><ProfileAvatar name={reportConversation.name} avatar={reportConversation.avatar} className="av" /><div><b><SafeText>{reportConversation.name}</SafeText></b><span>{reportConversation.type === 'group' ? '群聊' : '联系人'} · 从本地索引选择，生成时按范围读取正文</span></div><Check size={16} /></div> : <div className="report-selected empty">请先在左侧选择一个会话</div>}
                    {selectedReportScope && <div className="report-selected-scope"><b>仅总结已选消息 · {reportSnapshot?.key === reportSnapshotKey ? reportSnapshot.data.messages.length : selectedReportScope.items.length} 条</b><p>不自动添加其他消息或上下文；合并转发使用内部发言人。可通过内容类型进一步筛选。</p><ActionButton type="button" className="btn sm" onClick={() => { setSelectedId(selectedReportScope.conversationId); setChatPicking(true); setView('messages') }}>返回调整选择</ActionButton><ActionButton type="button" className="btn sm" onClick={() => { setReportScope(null); setReportSelectionVersion(version => version + 1) }}>改为按会话总结</ActionButton></div>}
                    <div className="group report-form">
                      <Field title="统计时间" hint="选择快捷日期或自定义时间范围">
                        <div className="report-date-control">
                          <div className="chips report-date-presets" aria-label="报告快捷日期" hidden={!!selectedReportScope}>
                            {reportDatePresets.map(item => <button type="button" key={item.id} className={`chip${reportDatePreset === item.id ? ' on' : ''}`} aria-pressed={reportDatePreset === item.id} onClick={() => selectReportDatePreset(item.id)}>{item.label}</button>)}
                          </div>
                          {selectedReportScope ? <span className="report-selection-dates">{reportStartDate} 至 {reportEndDate} · 按所选消息确定</span> : reportDatePreset === 'custom' && <div className="date-range"><Input className="inp" type="date" aria-label="报告开始日期" value={reportStartDate} max={reportEndDate} onChange={event => { setReportStartDate(event.target.value); setReportDatePreset('custom') }} /><span>至</span><Input className="inp" type="date" aria-label="报告结束日期" value={reportEndDate} min={reportStartDate} max={toDateInput(new Date())} onChange={event => { setReportEndDate(event.target.value); setReportDatePreset('custom') }} /></div>}
                        </div>
                      </Field>
                      <Field title="内容类型" hint={!reportConversation ? '请先选择会话' : !reportStartDate || !reportEndDate || reportStartDate > reportEndDate ? '请选择有效的日期范围' : !Object.values(reportContent).some(Boolean) ? '请至少选择一种内容类型' : reportDataLoading ? '正在读取会话记录…' : reportDataError ? `会话记录读取失败：${reportDataError}` : reportData ? `已从本地记录筛选，已勾选 ${reportSelectedCount} 条` : '等待读取完整记录'}>
                        {reportDataError && <Alert type="error" showIcon title="会话记录读取失败" description={reportDataError} action={<ActionButton type="button" className="btn sm" onClick={() => setReportSelectionVersion(version => version + 1)}>重新读取记录</ActionButton>} />}
                        <div className="report-checks">
                          {reportContentTypes.map(item => <label className={`report-check${reportContent[item.id] ? ' on' : ''}`} key={item.id}><input type="checkbox" checked={reportContent[item.id]} onChange={() => setReportContent(current => ({ ...current, [item.id]: !current[item.id] }))} /><span className="report-check-copy"><span className="report-check-title"><b>{item.label}</b><span className="report-count">{reportDataLoading ? '加载中' : reportDataError ? '读取失败' : reportData ? `${reportContentCounts[item.id]} 条` : '—'}</span></span><small>{item.hint}</small></span></label>)}
                        </div>
                      </Field>
                      <div className="report-model-row has-image-model">
                        <Field title="基础语言模型" hint="必需，用于理解内容并生成报告">
                          <select className="inp provider" aria-label="基础语言模型" value={reportModel?.id ?? ''} disabled={textModels.length === 0} onChange={event => setReportModelId(event.target.value)}>
                            {textModels.length === 0 ? <option value="">尚未配置基础语言模型</option> : textModels.map(config => <option key={config.id} value={config.id}>{config.name || config.model}{config.isDefault ? '（默认）' : ''}</option>)}
                          </select>
                          {!reportModel && <ActionButton type="button" className="btn sm" onClick={() => { newModel('text'); openSettings('model') }}>去配置</ActionButton>}
                        </Field>
                        <Field title="图片理解模型" hint="不默认选择，解析图片时手动选择">
                          <select className="inp provider" aria-label="图片理解模型" value={reportImageModel?.id ?? ''} disabled={imageModels.length === 0} onChange={event => setReportImageModelId(event.target.value)}>
                            <option value="">不选择</option>
                            {imageModels.map(config => <option key={config.id} value={config.id}>{config.name || config.model}</option>)}
                          </select>
                          {imageModels.length === 0 && <ActionButton type="button" className="btn sm" onClick={() => { newModel('image'); openSettings('model') }}>去配置</ActionButton>}
                        </Field>
                        {reportImageModel && <Field title="图片解析线程数" hint={`同时处理的图片数量，1–${MAX_IMAGE_CONCURRENCY}；默认 ${DEFAULT_IMAGE_CONCURRENCY}`}>
                          <Input className="inp" type="number" aria-label="图片解析线程数" min={1} max={MAX_IMAGE_CONCURRENCY} step={1} value={reportImageConcurrency} onChange={event => setReportImageConcurrency(event.target.value)} />
                        </Field>}
                      </div>
                      {reportConversation?.type === 'group' && <Field title="总结对象" hint="个人总结以该成员发言为主，结合所选范围内的群聊上下文；条数为当前日期与内容类型下的消息数。">
                        <select className="inp provider" aria-label="总结对象" value={reportTargetKey} disabled={reportDataLoading || !reportData} onChange={event => setReportTargetKey(event.target.value)}>
                          <option value="">整个群聊</option>
                          {reportTargetKey && !reportTargetMember && <option value={reportTargetKey}>所选成员在当前范围没有消息</option>}
                          {reportMembers.map(member => <option key={member.key} value={member.key}>{member.name}（{member.count} 条{reportMembers.filter(item => item.name === member.name).length > 1 ? ` · ${member.key}` : ''}）</option>)}
                        </select>
                      </Field>}
                      <Field title="报告模板" hint="系统内置，只影响展示排版">
                        <select className="inp provider" aria-label="报告模板" value={reportTemplate.id} onChange={event => setReportTemplateId(event.target.value)}>{availableReportTemplates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select>
                      </Field>
                      <Field title="报告风格" hint="影响内容侧重点、语气与详略，可自定义保存">
                        <div className="report-style-control">
                          <div className="report-style-toolbar">
                            <select className="inp provider" aria-label="报告风格" value={selectedReportStyle?.id ?? ''} disabled={reportStyleEditing || reportStyleSaving} onChange={event => setReportStyle(event.target.value)}>
                              <optgroup label="内置风格">{availableReportStyles.filter(style => style.builtin).map(style => <option key={style.id} value={style.id}>{style.name}</option>)}</optgroup>
                              {reportStyles.some(style => !style.builtin) && <optgroup label="我的风格">{reportStyles.filter(style => !style.builtin).map(style => <option key={style.id} value={style.id}>{style.name}</option>)}</optgroup>}
                            </select>
                            {!reportStyleEditing && <ActionButton className="btn sm" type="button" disabled={reportStyleSaving} onClick={() => editReportStyle()}>新建风格</ActionButton>}
                          </div>
                          {!reportStyleEditing && selectedReportStyle && <>
                            <details className="report-style-details" key={selectedReportStyle.id}><summary>查看风格提示词</summary><p className="report-style-description">{selectedReportStyle.prompt}</p></details>
                            <div className="report-style-actions"><ActionButton className="btn sm" type="button" disabled={reportStyleSaving} onClick={() => editReportStyle(selectedReportStyle)}>{selectedReportStyle.builtin ? '基于此风格自定义' : '编辑风格'}</ActionButton>{!selectedReportStyle.builtin && <ActionButton className="btn sm" type="button" disabled={reportStyleSaving} onClick={() => void deleteWritingStyle()}>删除风格</ActionButton>}</div>
                          </>}
                          {reportStyleEditing && <div className="report-style-editor">
                            <label>风格名称<Input className="inp" aria-label="自定义风格名称" maxLength={40} value={reportStyleName} disabled={reportStyleSaving} onChange={event => setReportStyleName(event.target.value)} placeholder="例如：项目进展周报" /></label>
                            <label>内容风格要求<textarea className="inp report-style-prompt" aria-label="自定义风格要求" rows={5} maxLength={3000} value={reportStyleDraft} disabled={reportStyleSaving} onChange={event => setReportStyleDraft(event.target.value)} placeholder="例如：语气正式，先总结进展，再列出明确决定、负责人和时间节点；最后说明待确认问题。" /></label>
                            <small>描述希望报告写什么、怎么写；展示效果由上方系统模板决定。</small>
                            <div className="report-style-actions"><ActionButton className="btn sm primary" type="button" disabled={reportStyleSaving || !reportStyleName.trim() || !reportStyleDraft.trim()} onClick={() => void saveWritingStyle()}>{reportStyleSaving ? '保存中…' : '保存风格'}</ActionButton><ActionButton className="btn sm" type="button" disabled={reportStyleSaving} onClick={() => setReportStyleEditing(false)}>取消</ActionButton></div>
                          </div>}
                        </div>
                      </Field>
                      <Field title="报告格式" hint="根据主要查看设备选择版式">
                        <div className="report-format-options">
                          <label className={`report-choice${reportFormat === 'mobile' ? ' on' : ''}`}><input type="radio" name="report-format" value="mobile" checked={reportFormat === 'mobile'} onChange={() => setReportFormat('mobile')} /><span><b>手机端</b><small>窄屏排版与长图，便于手机阅读</small></span></label>
                          <label className={`report-choice${reportFormat === 'desktop' ? ' on' : ''}`}><input type="radio" name="report-format" value="desktop" checked={reportFormat === 'desktop'} onChange={() => setReportFormat('desktop')} /><span><b>电脑端</b><small>宽屏排版与宽图，便于电脑查看</small></span></label>
                        </div>
                      </Field>
                    </div>
                    <div className="report-submit"><div><b>默认同时输出 HTML 和 PNG 两种文件</b><span>文本及语音转写发送至语言模型，图片发送至图片理解模型；视频仅统计。</span></div><ActionButton type="button" className="btn primary" disabled={reportRunning || reportStyleEditing || reportDataLoading || !reportData} onClick={() => void generateReport()}><FileText size={14} />{reportRunning ? '等待当前任务完成' : '生成报告'}</ActionButton></div>
                  </div>
                </div>
                <aside className="report-progress-panel" aria-label="报告生成进度" aria-live="polite">
                  <div className="report-task-heading"><h3>{reportTask ? '生成任务' : '任务预览'}</h3><span className={`report-task-status ${reportRunning ? 'running' : reportProgress?.stage === 'error' ? 'error' : generatedReport ? 'done' : ''}`}>{reportRunning ? '生成中' : reportProgress?.stage === 'error' ? '生成失败' : generatedReport ? '已完成' : '待提交'}</span></div>
                  {reportTask ? <section className="report-task-card" aria-label="当前报告任务">
                    <div className="report-task-identity"><ProfileAvatar name={reportTask.conversationName} avatar={reportTask.avatar} className="av" /><div><small>本次报告所属会话</small><h4><SafeText>{reportTask.conversationName}</SafeText></h4></div></div>
                    <dl className="report-task-summary"><div><dt>总结对象</dt><dd><SafeText>{reportTask.target}</SafeText></dd></div><div><dt>日期范围</dt><dd>{reportTask.startDate === reportTask.endDate ? reportTask.startDate : `${reportTask.startDate} 至 ${reportTask.endDate}`}</dd></div><div><dt>消息范围</dt><dd>{reportTask.selectionOnly ? '手动选择' : '所选日期'} · {reportTask.messageCount.toLocaleString()} 条消息</dd></div><div><dt>内容风格</dt><dd><SafeText>{reportTask.style}</SafeText></dd></div></dl>
                    <details><summary>查看任务配置</summary><dl><div><dt>语言模型</dt><dd><SafeText>{reportTask.model}</SafeText></dd></div>{reportTask.imageModel && <div><dt>图片模型</dt><dd><SafeText>{reportTask.imageModel}</SafeText> · {reportTask.concurrency} 线程</dd></div>}<div><dt>提交时间</dt><dd>{new Date(reportTask.startedAt).toLocaleString('zh-CN')}</dd></div></dl></details>
                    {reportConversationId !== reportTask.conversationId && <p className="report-task-scope-note">当前正在配置其他会话；以下进度和生成文件属于「<SafeText>{reportTask.conversationName}</SafeText>」。</p>}
                  </section> : <div className="report-task-empty"><FileText size={28} strokeWidth={1.4} /><b>准备好后开始生成</b><p>提交后，会话、总结对象和日期将固定显示在这里，切换会话也能随时确认任务。</p></div>}
                  <div className="report-task-heading report-stage-heading"><h4>处理进度</h4><span>{reportProgress?.percent ?? 0}%</span></div>
                  <p>{reportProgress?.detail || '配置完成后点击生成报告，处理进度将在这里显示。'}</p>
                  <div className="asr-download-track" role="progressbar" aria-label="报告处理进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={reportProgress?.percent ?? 0}><span style={{ width: `${reportProgress?.percent ?? 0}%` }} /></div>
                  {reportProgress?.media && <div className="report-media-stats">
                    {([{ key: 'voice', label: '语音识别', unit: '条' }, { key: 'image', label: '图片理解', unit: '张' }] as const).map(item => {
                      const stats = reportProgress.media![item.key]
                      return <section className="report-media-stat" aria-label={`${item.label}统计`} key={item.key}>
                        <h4>{item.label}<span>{stats.processed}/{stats.total} {item.unit}</span></h4>
                        <div className="report-media-counts"><span className="success">成功 <b>{stats.succeeded}</b></span><span className="failure">失败 <b>{stats.failed}</b></span><span>待处理 <b>{stats.total - stats.processed}</b></span></div>
                        <small>成功数含缓存复用 {stats.cached} {item.unit}</small>
                      </section>
                    })}
                  </div>}
                  <ol>{([{ id: 'read', label: '筛选已加载记录' }, { id: 'voice', label: '本地离线语音识别' }, { id: 'image', label: '图片理解' }, { id: 'summarize', label: '模型分析与报告生成' }, { id: 'export', label: '保存 HTML 与 PNG' }] as const).map((step, index, steps) => {
                    const activeIndex = steps.findIndex(item => item.id === reportProgress?.stage)
                    const done = reportProgress?.stage === 'done' || activeIndex > index
                    return <li key={step.id} className={done ? 'done' : reportProgress?.stage === step.id ? 'active' : ''}><span>{done ? '✓' : index + 1}</span>{step.label}</li>
                  })}</ol>
                  <small>视频仅计入数量，不读取或解析内容。生成期间可查看其他页面，当前任务使用开始时的配置。</small>
                  {reportProgress?.stage === 'error' && <div className="report-progress-error" role="alert">
                    <strong>生成失败：{reportProgress.detail}</strong>
                    {reportProgress.failedStep && <p>失败位置：{reportProgress.failedStep}</p>}
                    {reportProgress.advice && <p>排查建议：{reportProgress.advice}</p>}
                    <p>任务编号：{reportProgress.requestId}</p>
                    {reportProgress.diagnosticPath && <button type="button" onClick={() => void window.wetrace.openReport(reportProgress.diagnosticPath!).catch(error => notify(error instanceof Error ? error.message : '打开诊断日志失败'))}>打开诊断日志</button>}
                  </div>}
                  {generatedReport && <div className="report-output"><ActionButton className="btn primary" disabled={copyingReportImage || !generatedReport.pngPaths.length} onClick={() => void copyGeneratedReportImage()}>{copyingReportImage ? '复制中…' : '复制图片'}</ActionButton><ActionButton type="button" className="btn sm" onClick={() => void window.wetrace.revealReport(generatedReport.htmlPath).catch(error => notify(error instanceof Error ? error.message : '打开文件夹失败'))}><FolderOpen size={14} />打开所在文件夹</ActionButton><small className="report-output-path">保存位置：{generatedReport.htmlPath.replace(/[\\/][^\\/]+$/, '')}</small>{generatedReport.warnings.length > 0 && <details><summary>{generatedReport.warnings.length} 条素材处理说明</summary>{generatedReport.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}</div>}
                </aside>
              </div>
            )}
          </section>
        )}

        {view === 'settings' && (
          <section className="view active" aria-label="设置">
            <div className="set-layout">
              <nav className="set-nav">
                <div className="t">设置</div>
                {settingsNav.map(({ id, label, icon: Icon }) => (
                  <button
                    type="button"
                    key={id}
                    className={`set-item${settingsPanel === id ? ' on' : ''}`}
                    aria-pressed={settingsPanel === id}
                    onClick={() => setSettingsPanel(id)}
                  >
                    <Icon size={15} strokeWidth={1.7} />{label}
                  </button>
                ))}
              </nav>

              <div className="set-body">
                {settingsPanel === 'db' && (
                  <div className="panel active">
                    <h2>数据库与账号</h2>
                    <ChatIndexPanel state={chatIndexState} />
                    <p className="desc">连接本机微信数据。WeTrace 始终以只读方式访问，不会修改或回写微信数据库。</p>
                    <div className="group">
                      <Field title="数据目录" hint="微信 4.x 的 xwechat_files">
                        <span className="path" title={displayDirectory}>{displayDirectory}</span>
                        <ActionButton type="button" className="btn sm" onClick={() => void selectDirectory()}>更改</ActionButton>
                      </Field>
                      <Field title="当前账号" hint={account?.id ?? '未检测到账号'}>
                        {account ? (
                          <span className="account-summary">
                            <ProfileAvatar name={accountName} avatar={account.avatar} className="settings-avatar" />
                            <span className="kv"><SafeText>{accountName}</SafeText><small>{account.wxid}</small></span>
                          </span>
                        ) : (
                          <span className="kv">未连接<small>请先登录微信桌面版</small></span>
                        )}
                      </Field>
                      <Field title="切换账号" hint="选择本机已发现的微信账号">
                        <select className="inp provider" value={account?.root ?? ''} disabled={syncing || accounts.length === 0} onChange={(event) => void switchAccount(event.target.value)}>
                          {accounts.map((item) => <option key={item.root} value={item.root}>{item.wxid}</option>)}
                        </select>
                        <ActionButton type="button" className="btn sm" onClick={disconnectAccount}>退出 WeTrace</ActionButton>
                      </Field>
                      <Field title="数据库密钥" hint="用于解密本地 SQLCipher">
                        <span className="kv">
                          {detected?.hasKey ? '已获取' : '待获取'}
                          <small>
                            {detected?.hasKey
                              ? '仅保存在本机安全存储，无需重复获取'
                              : keyStatus?.sipEnabled !== false
                                ? '需先关闭 SIP，点击右侧查看步骤'
                                : '点击后按提示先退出微信账号'}
                          </small>
                        </span>
                        <ActionButton type="button" className="btn sm" disabled={syncing} onClick={() => void startKeyCapture()}>
                          <KeyRound size={13} />{detected?.hasKey ? '重新获取' : '获取密钥'}
                        </ActionButton>
                      </Field>
                      <Field title="同步" hint="读取本机微信数据库">
                        <span className="kv">
                          {real ? `${real.messageTotal.toLocaleString('en-US')} 条 · ${real.conversations.length} 个会话` : '尚未同步'}
                          <small>{real ? `最后同步 ${new Date(real.syncedAt).toLocaleString('zh-CN')}` : '尚未同步'}</small>
                        </span>
                        <ActionButton type="button" className="btn sm primary" disabled={syncing} onClick={() => void runSync()}><RefreshCw size={13} />立即同步</ActionButton>
                      </Field>
                      {autoSyncError && <div className="settings-sync-error">自动刷新失败：{autoSyncError}</div>}
                    </div>
                  </div>
                )}

                {settingsPanel === 'image' && (
                  <div className="panel active">
                    <h2>图片解密</h2>
                    <p className="desc">自动在本机解密聊天图片，支持旧版 XOR 与新版 V1/V2。优先显示原图，微信专用图片格式会尝试使用缩略图。</p>
                    <div className="group">
                      <Field title="图片解密" hint="读取消息时自动处理"><span className="kv">已启用 · 仅本机</span></Field>
                      <Field title="图片密钥" hint="与数据库密钥相互独立"><span className="kv">从微信本地缓存自动识别<small>无需填写或重新获取数据库密钥</small></span></Field>
                      <Field title="当前会话记录" hint="最近读取的聊天图片">
                        <span className="kv">已解密 {imageStats.available} / {imageStats.total} 张</span>
                        <ActionButton type="button" className="btn sm" disabled={syncing} onClick={() => void doSync(rootDir ?? undefined)}>重新读取</ActionButton>
                      </Field>
                      <Field title="存储方式" hint="不改写微信原文件"><span className="kv">仅保留在当前应用内存<small>尚未下载的图片，请先在微信中打开后重新读取</small></span></Field>
                    </div>
                  </div>
                )}

                {settingsPanel === 'model' && (
                  <div className="panel active">
                    <h2>模型配置</h2>
                    <p className="desc">保存常用模型配置，可编辑并测试连接。API Key 会加密保存在本机，不会在列表中显示。</p>
                    <div className="group">
                      <Field title="配置名称" hint="用于后续选择模型"><Input className="inp" value={modelConfigName} onChange={event => setModelConfigName(event.target.value)} placeholder="例如：日常总结模型" /></Field>
                      {modelKind === 'speech' && <Field title="模型来源" hint="本地模型需要指定模型文件所在目录">
                        <select className="inp provider" value={modelSource} onChange={event => changeModelSource(event.target.value as ModelSource)}><option value="remote">在线服务</option><option value="local">本地模型</option></select>
                      </Field>}
                      {modelSource === 'remote' ? <>
                        <Field title="模型模板" hint="选择后自动填写地址与模型 ID">
                          <select className="inp provider" value={provider} onChange={(event) => applyModelPreset(event.target.value, apiFormat, modelKind)}>
                            {[...new Set([...modelProviders, provider])].map(item => <option key={item}>{item}</option>)}
                          </select>
                        </Field>
                        <Field title="接口格式" hint="默认 OpenAI">
                          <select className="inp provider" value={apiFormat} onChange={event => applyModelPreset(provider, event.target.value as ApiFormat, modelKind)}><option value="openai">base_url (OpenAI)</option><option value="anthropic">base_url (Anthropic)</option></select>
                        </Field>
                        <Field title="Base URL" hint={apiFormat === 'anthropic' ? 'Anthropic 兼容地址，不含 /messages' : 'OpenAI 兼容地址，不含 /chat/completions'}><Input className="inp" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" spellCheck={false} /></Field>
                        <Field title="模型 ID" hint="支持填写任意服务商提供的模型 ID"><Input className="inp" value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder={modelKind === 'text' ? 'deepseek-chat' : '填写图片模型 ID'} spellCheck={false} /></Field>
                        <Field title="API Key" required hint="加密保存在本机">
                          <Input className="inp" type="password" value={apiKey} placeholder="请输入 API Key" onChange={(event) => setApiKey(event.target.value)} autoComplete="off" required />
                          <ActionButton type="button" className="btn sm" disabled={savingModel || testingModelId !== null} onClick={() => void testModel({ name: modelConfigName, provider, kind: modelKind, source: modelSource, apiFormat, baseUrl, model: modelName, localPath: localModelPath, apiKey })}>{testingModelId === 'form' ? '测试中…' : '测试连接'}</ActionButton>
                        </Field>
                      </> : <>
                        <Field title="模型目录" hint="选择包含本地模型文件的目录">
                          <Input className="inp" value={localModelPath} onChange={event => setLocalModelPath(event.target.value)} placeholder="/path/to/speech-model" spellCheck={false} />
                          <ActionButton type="button" className="btn sm" onClick={() => void window.wetrace.selectDirectory('选择本地语音模型目录').then(directory => { if (directory) setLocalModelPath(directory) }).catch(() => undefined)}><FolderOpen size={13} />选择目录</ActionButton>
                        </Field>
                        <Field title="模型名称" hint="例如 SenseVoice Small INT8"><Input className="inp" value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder="SenseVoice Small INT8" spellCheck={false} /></Field>
                      </>}
                      <Field title="保存配置" hint="添加到下方列表">
                        {modelSource === 'local' && <ActionButton type="button" className="btn sm" disabled={savingModel || testingModelId !== null} onClick={() => void testModel({ name: modelConfigName, provider, kind: modelKind, source: modelSource, apiFormat, baseUrl, model: modelName, localPath: localModelPath, apiKey })}>{testingModelId === 'form' ? '检测中…' : '检测目录'}</ActionButton>}
                        <ActionButton type="button" className="btn sm primary" disabled={savingModel || testingModelId !== null} onClick={() => void saveModel({ name: modelConfigName, provider, kind: modelKind, source: modelSource, apiFormat, baseUrl, model: modelName, localPath: localModelPath, apiKey })}>{savingModel ? '保存中…' : '保存模型'}</ActionButton>
                      </Field>
                    </div>
                    <div className="model-list-head"><h3>已配置模型</h3><span>{configurableModels.length} 个</span></div>
                    {configurableModels.length ? (
                      <div className="model-list">
                        {configurableModels.map((config) => {
                          const displayName = config.name || config.model
                          const editorId = `model-editor-${config.id}`
                          const expanded = editingModelId === config.id
                          const local = config.source === 'local'
                          return (
                            <div className={`model-list-item${expanded ? ' selected' : ''}`} key={config.id}>
                              <div className="model-list-summary">
                                <button type="button" className="model-list-select" onClick={() => editModel(config)} aria-label={`${expanded ? '收起' : '编辑'} ${displayName}`} aria-expanded={expanded} aria-controls={editorId}>
                                  <b><SafeText>{displayName}</SafeText></b><span>{modelKindLabels[config.kind ?? 'text']} · {config.model} · {local ? `本地模型 · ${config.localPath}` : `${config.provider} · ${config.baseUrl}`}</span>
                                </button>
                                <span className="model-key-state">{local ? '本地目录' : config.hasApiKey ? '已设置密钥' : '无密钥'}</span>
                                {config.isDefault ? <span className="model-default-state">默认</span> : <ActionButton type="button" className="btn sm" disabled={savingModel} onClick={() => void setDefaultModel(config)}>设为默认</ActionButton>}
                                <ActionButton type="button" className="btn sm" disabled={testingModelId !== null} onClick={() => void testModel({ id: config.id, name: displayName, kind: config.kind, source: config.source, apiFormat: config.apiFormat, provider: config.provider, baseUrl: config.baseUrl, model: config.model, localPath: config.localPath })}>{testingModelId === config.id ? local ? '检测中…' : '测试中…' : local ? '检测目录' : '测试'}</ActionButton>
                                <ActionButton type="button" className="btn sm" aria-expanded={expanded} aria-controls={editorId} onClick={() => editModel(config)}>{expanded ? '收起' : '编辑'}</ActionButton>
                                <ActionButton type="button" className="btn sm danger" onClick={() => void removeModel(config)}>删除</ActionButton>
                              </div>
                              {expanded && <div className="model-inline-editor" id={editorId}><ModelConfigEditor config={config} saving={savingModel} testingId={testingModelId} onSave={saveModel} onTest={testModel} onCancel={() => setEditingModelId(null)} /></div>}
                            </div>
                          )
                        })}
                      </div>
                    ) : <p className="model-list-empty">还没有保存的模型配置。</p>}
                  </div>
                )}

                {settingsPanel === 'asr' && (
                  <div className="panel active">
                    <h2>语音转文字</h2>
                    <p className="desc">使用固定的本地离线模型，暂不支持在线服务或自定义模型配置。下载模型不会自动处理聊天语音。</p>
                    <div className="asr-privacy">
                      <span className="asr-privacy-icon"><ShieldCheck size={18} /></span>
                      <div><b>本地模型，隐私优先</b><p>语音在本机识别，无需上传；成功转写会缓存，报告重试时自动复用。</p></div>
                    </div>
                    <div className="group asr-runtime">
                      <Field title="当前平台" hint="当前应用运行环境"><span className="kv">{appPlatform === 'darwin' ? 'macOS' : appPlatform === 'win32' ? 'Windows' : appPlatform === 'linux' ? 'Linux' : appPlatform || '读取中…'}</span></Field>
                      <Field title="离线识别能力" hint="固定使用本地模型"><span className="kv">模型文件管理<small>已接入 SenseVoice 离线识别</small></span></Field>
                      <Field title="识别引擎" hint="不会根据目录名称伪造引擎状态"><span className="kv">待接入</span></Field>
                    </div>

                    <div className="asr-section-head"><div><h3>本地语音模型</h3><p>下载并校验模型文件，无需配置。</p></div></div>
                    <article className="asr-model-card asr-recommended-model">
                      <div className="asr-model-top">
                        <span className="asr-model-icon"><Mic size={17} /></span>
                        <div className="asr-model-name"><b>SenseVoice Small INT8</b><span>{voiceModelStatus ? `版本 ${voiceModelStatus.version} · ${formatBytes(voiceModelStatus.totalBytes)}` : '正在读取模型信息…'}</span></div>
                        <span className={voiceModelStatus?.state === 'ready' ? 'asr-configured' : 'asr-download-state'}>{voiceModelStatus?.state === 'ready' && <Check size={12} />}{voiceModelStateText}</span>
                      </div>
                      <div className="asr-model-path"><span>下载目录</span><code title={voiceModelStatus?.directory}><SafeText>{voiceModelStatus?.directory ?? '读取中…'}</SafeText></code></div>
                      {voiceModelStatus && (voiceModelStatus.state === 'downloading' || voiceModelStatus.downloadedBytes > 0) && <div className="asr-download-progress" aria-live="polite">
                        <div className="asr-download-meta"><span>{voiceModelStatus.state === 'ready' ? '下载与校验完成' : `已下载 ${voiceModelPercent}%`}</span><span>{formatBytes(voiceModelStatus.downloadedBytes)} / {formatBytes(voiceModelStatus.totalBytes)}</span></div>
                        <div className="asr-download-track" role="progressbar" aria-label="语音模型下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={voiceModelPercent}><span style={{ width: `${voiceModelPercent}%` }} /></div>
                      </div>}
                      {voiceModelStatus?.error && <p className="asr-download-error">{voiceModelStatus.error}</p>}
                      <div className="asr-model-actions">
                        {!voiceModelStatus && <ActionButton type="button" className="btn sm" disabled>正在检测模型…</ActionButton>}
                        {voiceModelStatus && !['downloading', 'ready', 'unsupported'].includes(voiceModelStatus.state) && <ActionButton type="button" className="btn sm primary" disabled={voiceModelBusy || !voiceModelStatus.supported} onClick={() => void downloadVoiceModel()}><Download size={13} />{voiceModelBusy ? '准备下载…' : voiceModelStatus.state === 'invalid' || voiceModelStatus.state === 'error' ? '重新下载' : '下载模型'}</ActionButton>}
                        {voiceModelStatus?.state === 'downloading' && <ActionButton type="button" className="btn sm danger" onClick={() => void cancelVoiceModelDownload()}><X size={13} />取消下载</ActionButton>}
                        {voiceModelStatus && voiceModelStatus.state !== 'downloading' && <ActionButton type="button" className="btn sm" disabled={voiceModelBusy} onClick={() => void refreshVoiceModel()}><RefreshCw size={13} className={voiceModelBusy ? 'spin' : undefined} />{voiceModelBusy ? '检测中…' : '重新检测'}</ActionButton>}
                        {voiceModelStatus && <ActionButton type="button" className="btn sm" onClick={() => void openDownloadedVoiceModelDirectory()}><FolderOpen size={13} />打开目录</ActionButton>}
                        {voiceModelStatus && voiceModelStatus.state !== 'downloading' && (voiceModelStatus.state === 'ready' || voiceModelStatus.state === 'invalid' || voiceModelStatus.state === 'error' || voiceModelStatus.downloadedBytes > 0) && <ActionButton type="button" className="btn sm danger" disabled={voiceModelBusy} onClick={() => void removeDownloadedVoiceModel()}><Trash2 size={13} />删除模型文件</ActionButton>}
                      </div>
                    </article>

                  </div>
                )}

                {settingsPanel === 'cache' && (
                  <div className="panel active">
                    <h2>缓存与索引</h2>
                    <ChatIndexPanel state={chatIndexState} />
                    <p className="desc">语音转写、图片理解和报告会话记录保存在本机，重试或重新打开应用后可复用。下方统计全部会话已成功保存的结果；不同模型或版本可能分别缓存，不代表聊天中的全部素材数量。</p>
                    <div className="group">
                      <Field title="语音转写缓存" hint="已成功转写并保存到本机的语音"><span className="kv">{mediaCacheStats ? `${mediaCacheStats.voice.count.toLocaleString()} 条 · ${formatBytes(mediaCacheStats.voice.bytes)}` : mediaCacheError ? '读取失败' : '统计中…'}</span></Field>
                      <Field title="图片理解缓存" hint="已成功理解并保存到本机的图片"><span className="kv">{mediaCacheStats ? `${mediaCacheStats.image.count.toLocaleString()} 张 · ${formatBytes(mediaCacheStats.image.bytes)}` : mediaCacheError ? '读取失败' : '统计中…'}</span></Field>
                      <Field title="刷新统计" hint={mediaCacheError || '生成报告后可刷新查看新增缓存'}><ActionButton type="button" className="btn sm" disabled={mediaCacheBusy} onClick={() => void refreshCacheStats()}><RefreshCw size={13} className={mediaCacheBusy ? 'spin' : undefined} />{mediaCacheBusy ? '统计中…' : '刷新统计'}</ActionButton></Field>
                      <Field title="缓存占用" hint="WeTrace 本地缓存"><span className="kv">{cacheBytes === null ? '统计中…' : formatBytes(cacheBytes)}</span></Field>
                      <Field title="缓存目录" hint="可迁移到其他磁盘">
                        <span className="path">~/Library/Application Support/WeTrace/cache</span>
                        <ActionButton type="button" className="btn sm" onClick={() => notify('缓存目录迁移将在真实数据接入后开放')}>更改</ActionButton>
                      </Field>
                      <Field title="清理" hint="保留关系档案与报告">
                        <ActionButton type="button" className="btn sm" onClick={() => notify('当前没有需要清理的图片缓存')}>清理图片缓存</ActionButton>
                        <ActionButton type="button" className="btn sm" onClick={() => notify('请使用上方“更新索引”增量更新聊天记录')}>索引管理</ActionButton>
                      </Field>
                      <Field title="清空全部本地数据" hint="不可恢复">
                        <ActionButton type="button" className="btn sm danger" onClick={() => notify('真实数据接入后，这里会提供二次确认流程')}><Trash2 size={13} />清空数据</ActionButton>
                      </Field>
                    </div>
                  </div>
                )}

                {settingsPanel === 'about' && (
                  <div className="panel active">
                    <h2>关于</h2>
                    <div className="about-card">
                      <div className="appmark">
                        <div className="lg">W</div>
                        <div><b>WeTrace</b><span>版本 {appVersion} · 本地优先</span></div>
                      </div>
                      <p>WeTrace 在你的电脑上读取微信聊天记录，整理成可以回看的关系时间线。原始消息只存在本机，只有你配置的模型服务会收到文本片段。</p>
                      <div className="about-links">
                        <button type="button" onClick={() => notify('隐私说明将随第一个可用版本提供')}>隐私说明</button>
                        <button type="button" onClick={() => notify('当前已是最新界面版本')}>检查更新</button>
                        <button type="button" onClick={() => notify('问题反馈入口将在发布版本中提供')}>反馈问题</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
      <SipGuide
        open={sipGuide}
        onClose={() => setSipGuide(false)}
        onCopied={() => notify('已复制命令')}
        onRetry={() => {
          setSipGuide(false)
          void refreshStatus()
        }}
      />
      {toast && <Alert className="toast" role="status" type="info" showIcon title={toast} />}
    </div>
  )
}
