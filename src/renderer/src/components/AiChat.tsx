import { AiProfileDialog } from './AiProfileDialog'
import { AiEvidenceDialog } from './AiEvidenceDialog'
import { AiMemoryPanel } from './AiMemoryPanel'
import { Alert, Avatar, Badge, Button, Dropdown, Empty, Input, Select, Tag, Tooltip } from 'antd'
import { ActionButton } from './ui/ActionButton'
import { conversationAiContext } from '../../../shared/ai-chat-context'
import { AiKnowledgePanel } from './AiKnowledgePanel'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { ArrowUp, LoaderCircle, Sparkles, Plus, MessageSquare, Trash2, Square, Pencil, Settings2, ShieldCheck, Search, ChevronDown, Copy, Check } from 'lucide-react'
import type { ConversationOption, ModelConfig, SyncConversation } from '../../../shared/types'
import type { AiChatTurn, AiChatContext, AiConversationLaunch, AiConversationMemory, AiProfileRequest } from '../../../shared/ai-chat'

type SavedChat = import('../../../shared/ai-chat-history').StoredAiChat
function readChats(key: string): SavedChat[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter(item => typeof item.id === 'string' && typeof item.title === 'string' && Array.isArray(item.turns) && item.turns.every((turn: AiChatTurn) => ['user', 'assistant'].includes(turn.role) && typeof turn.content === 'string')).map(item => ({ ...item, context: item.context && typeof item.context.conversationId === 'string' && typeof item.context.conversationName === 'string' ? { conversationId: item.context.conversationId, conversationName: item.context.conversationName } : undefined })) : []
  } catch { return [] }
}

function MessageActions({ turn, root }: { turn: AiChatTurn; root?: string }) {
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  useEffect(() => {
    if (copyState === 'idle') return
    const timer = setTimeout(() => setCopyState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [copyState])
  const date = typeof turn.createdAt === 'number' && Number.isFinite(turn.createdAt) ? new Date(turn.createdAt) : undefined
  const validDate = date && Number.isFinite(date.getTime()) ? date : undefined
  const timeLabel = validDate?.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  async function copy() {
    try { await navigator.clipboard.writeText(turn.content); setCopyState('copied') }
    catch { setCopyState('error') }
  }
  return <div className={turn.role === 'user' ? 'ai-user-message-actions' : 'ai-assistant-message-actions'}>
    {turn.role === 'user' && (validDate ? <time dateTime={validDate.toISOString()}>{timeLabel}</time> : <span>发送时间未记录</span>)}
    <Tooltip title={copyState === 'copied' ? null : copyState === 'error' ? '复制失败，请重试' : '复制'}>
      <Button type="text" size="small" aria-label={copyState === 'copied' ? '已复制消息' : '复制消息'} onClick={() => void copy()} icon={copyState === 'copied' ? <Check size={14} /> : <Copy size={14} />} />
    </Tooltip>
    {turn.role === 'assistant' && root && turn.queryState && <Button type="text" size="small" onClick={() => setEvidenceOpen(true)}>查看原话</Button>}
    {evidenceOpen && root && turn.queryState && <AiEvidenceDialog root={root} state={turn.queryState} onClose={() => setEvidenceOpen(false)} />}
    <span className="ai-copy-feedback" role="status">{copyState === 'error' ? '复制失败，请重试' : ''}</span>
  </div>
}

export function AiChat({ root, conversations, models, onSettings, launch, onBusyChange }: { root?: string; conversations: SyncConversation[]; models: ModelConfig[]; onSettings: () => void; launch?: AiConversationLaunch; onBusyChange?: (busy: boolean) => void }) {
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [conversationSearch, setConversationSearch] = useState('')
  const [conversationOptions, setConversationOptions] = useState<ConversationOption[]>([])
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [conversationLoadError, setConversationLoadError] = useState('')
  useEffect(() => {
    if (!root) return
    let cancelled = false
    setLoadingConversations(true)
    setConversationLoadError('')
    Promise.resolve().then(() => window.wetrace.listConversationOptions(root)).then(response => {
      if (cancelled) return
      if (!response.ok) throw new Error(response.error)
      setConversationOptions(response.conversations)
    }).catch(error => {
      if (!cancelled) setConversationLoadError(error instanceof Error ? error.message : '读取会话列表失败')
    }).finally(() => { if (!cancelled) setLoadingConversations(false) })
    return () => { cancelled = true }
  }, [root])
  const storageKey = `wetrace:ai-chats:${root ?? 'none'}`
  const [chats, setChats] = useState<SavedChat[]>([])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const cancelRename = useRef(false)
  function saveRename(id: string) {
    if (!cancelRename.current && renameTitle.trim()) setChats(items => items.map(item => item.id === id ? { ...item, title: renameTitle.trim() } : item))
    setRenamingId(null)
  }
  const [activeId, setActiveId] = useState<string | null>(null)
  const [historyReady, setHistoryReady] = useState(false)
  const historyRevision = useRef(0)
  const historyWrites = useRef<Promise<void>>(Promise.resolve())
  const historyWriteBlocked = useRef(false)
  const jobs = useRef(new Map<string, { requestId: string; turns: AiChatTurn[]; partial: string; progress: string; startedAt: number }>())
  const [, refreshJobs] = useState(0)
  const alive = useRef(true)
  const newDraftSending = useRef(false)
  useEffect(() => { if (activeId) newDraftSending.current = false }, [activeId])
  const busy = jobs.current.size > 0
  const activeJob = activeId ? jobs.current.get(activeId) : undefined
  const activeBusy = Boolean(activeJob)
  const savedTurns = chats.find(chat => chat.id === activeId)?.turns ?? []
  const turns = activeJob && chats.find(chat => chat.id === activeId)?.pending && savedTurns.at(-1)?.role === 'assistant' ? savedTurns.slice(0, -1) : savedTurns
  const progress = activeJob?.progress ?? '正在理解问题…'
  const streaming = activeJob?.partial ?? ''
  const elapsed = activeJob ? Math.floor((Date.now() - activeJob.startedAt) / 1000) : 0
  const [storageError, setStorageError] = useState('')
  useEffect(() => {
    let cancelled = false
    if (!root) { setHistoryReady(true); return }
    if (typeof window.wetrace.loadAiChatHistory !== 'function') { setStorageError('本地对话接口尚未加载，请完全退出并重新启动 WeTrace'); return }
    let legacyActive: string | null = null
    try { legacyActive = localStorage.getItem(`${storageKey}:active`) } catch { /* Legacy storage may be unavailable. */ }
    void window.wetrace.loadAiChatHistory({ root, legacy: { chats: readChats(storageKey), activeId: legacyActive } }).then(response => {
      if (cancelled) return
      if (!response.ok) throw new Error(response.error)
      historyRevision.current = response.revision
      setChats(response.archive.chats)
      setActiveId(response.archive.activeId)
      setHistoryReady(true)
    }).catch(error => { if (!cancelled) setStorageError(error instanceof Error ? error.message : '读取本地对话失败') })
    return () => { cancelled = true }
  }, [root, storageKey])
  useEffect(() => {
    if (!historyReady || !root || historyWriteBlocked.current) return
    const archive = { chats, activeId }
    // Preserve write order, including partial answers, and never overwrite a newer disk revision.
    historyWrites.current = historyWrites.current.then(async () => {
      if (historyWriteBlocked.current) return
      const response = await window.wetrace.saveAiChatHistory({ root, archive, revision: historyRevision.current })
      if (!response.ok) throw new Error(response.error)
      historyRevision.current = response.revision
      setStorageError('')
    }).catch(error => {
      historyWriteBlocked.current = true
      setStorageError(`${error instanceof Error ? error.message : '本地对话保存失败'}。当前修改尚未保存，请保留窗口并检查磁盘空间。`)
    })
  }, [chats, activeId, historyReady, root])
  useEffect(() => {
    alive.current = true
    const unprogress = window.wetrace.onAiProgress(event => {
      const job = [...jobs.current.values()].find(item => item.requestId === event.requestId)
      if (job) { job.progress = event.detail; refreshJobs(version => version + 1) }
    })
    const unsubscribe = window.wetrace.onAiDelta(delta => {
      const job = [...jobs.current.values()].find(item => item.requestId === delta.requestId)
      if (job) { job.partial += delta.text; refreshJobs(version => version + 1) }
    })
    return () => {
      alive.current = false
      unprogress(); unsubscribe()
      for (const job of jobs.current.values()) void window.wetrace.cancelAi(job.requestId)
    }
  }, [])
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!jobs.current.size) return
      refreshJobs(version => version + 1)
      setChats(items => {
        let changed = false
        const next = items.map(chat => {
          const job = jobs.current.get(chat.id)
          if (!job?.partial || (chat.pending && chat.turns.at(-1)?.content === job.partial)) return chat
          changed = true
          return { ...chat, pending: true, turns: [...job.turns, { role: 'assistant' as const, content: job.partial }] }
        })
        return changed ? next : items
      })
    }, 500)
    return () => window.clearInterval(timer)
  }, [])
  function newChat() { newDraftSending.current = false; setActiveId(null); setDraftContext(undefined) }
  function updateChat(id: string, next: AiChatTurn[], context?: AiChatContext, memory?: AiConversationMemory) {
    setChats(items => {
      const existing = items.find(item => item.id === id)
      return [{ id, memory: memory ?? existing?.memory, title: existing?.title ?? (context ? `与${context.conversationName}的聊天` : next[0]?.content.slice(0, 36) || '新对话'), turns: next, context: context ?? existing?.context, updatedAt: Date.now() }, ...items.filter(item => item.id !== id)]
    })
  }
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const question = drafts[activeId ?? 'new'] ?? ''
  function setQuestion(value: string) { setDrafts(items => ({ ...items, [activeId ?? 'new']: value })) }
  const [modelId, setModelId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const error = errors[activeId ?? 'new'] ?? ''
  const bottom = useRef<HTMLDivElement>(null)
  const questionInput = useRef<ComponentRef<typeof Input.TextArea>>(null)
  const available = models.filter(model => (model.kind === 'text' || model.kind === 'image') && model.source === 'remote')
  const selected = available.find(model => model.id === modelId) ?? available.find(model => model.isDefault) ?? available[0]
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [activeId, turns, activeBusy, error, activeBusy ? streaming : null])
  const consumedLaunch = useRef<string | null>(null)
  const [draftContext, setDraftContext] = useState<AiChatContext>()
  const context = activeId ? chats.find(chat => chat.id === activeId)?.context : draftContext
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false) }, [busy, onBusyChange])
  useEffect(() => {
    if (!historyReady || !launch || launch.root !== root || consumedLaunch.current === launch.id || !root) return
    consumedLaunch.current = launch.id
    const existing = chats.find(chat => chat.context?.conversationId === launch.context.conversationId)
    setActiveId(existing?.id ?? null)
    if (!existing) setDraftContext(launch.context)
  }, [launch?.id, root, historyReady])
  const shownContext = context
  const catalogAvatars = new Map(conversationOptions.map(item => [item.id, item.avatar]))
  const knownConversations = [...new Map([...conversationOptions, ...conversations].map(item => [item.id, { ...item, avatar: item.avatar || catalogAvatars.get(item.id) }])).values()]
  const selectableConversations = knownConversations.filter(item => item.type === 'group' || item.type === 'friend')
  const visibleChats = chats.filter(chat => chat.title.toLocaleLowerCase().includes(historySearch.trim().toLocaleLowerCase()))
  function selectConversation(conversation?: ConversationOption) {
    if (activeBusy) return
    if (conversation?.id === context?.conversationId) return
    const nextContext = conversation ? conversationAiContext(conversation) : undefined
    // Selecting a source only edits the unsent draft. Persist history on send.
    newDraftSending.current = false
    setDraftContext(nextContext)
    if (activeId) setDrafts(items => ({ ...items, new: question }))
    setActiveId(null)
  }

  async function send(profile?: AiProfileRequest) {
    const selectedConversation = profile ? knownConversations.find(item => item.id === profile.conversationId) : undefined
    const prompt = profile ? `分析一下${profile.targetName}${profile.timeRange === 'all' ? '，使用全部本地历史' : `，时间范围 ${profile.startDate} 至 ${profile.endDate}`}。` : question.trim()
    const previous = profile ? [] : turns
    const attached = selectedConversation ? conversationAiContext(selectedConversation) : context
    if (!historyReady || historyWriteBlocked.current || (!activeId && newDraftSending.current) || (activeId && jobs.current.has(activeId)) || !prompt || !root || !selected) return
    const next: AiChatTurn[] = [...previous, { role: 'user', content: prompt, createdAt: Date.now() }]
    const id = profile ? crypto.randomUUID() : activeId ?? crypto.randomUUID()
    const requestId = crypto.randomUUID()
    if (!activeId) newDraftSending.current = true
    const job = { requestId, turns: next, partial: '', progress: '正在理解问题…', startedAt: Date.now() }
    jobs.current.set(id, job)
    refreshJobs(version => version + 1)
    setActiveId(id); updateChat(id, next, attached)
    setErrors(items => ({ ...items, [id]: '' })); setDrafts(items => ({ ...items, [activeId ?? 'new']: '', [id]: '' }))
    try {
      const response = await window.wetrace.askAi({ requestId, chatId: id, root, modelId: selected.id, conversations: knownConversations.map(({ id, name }) => ({ id, name })), turns: next, context: attached, memory: chats.find(chat => chat.id === id)?.memory, profile })
      if (!alive.current) return
      if (!response.ok) throw new Error(response.error)
      updateChat(id, [...next, { role: 'assistant', content: response.answer, queryState: response.queryState }], undefined, response.memory)
    } catch (err) {
      if (!alive.current) return
      setErrors(items => ({ ...items, [id]: err instanceof Error ? err.message : '请求失败，请重试' }))
      if (job.partial) updateChat(id, [...next, { role: 'assistant', content: job.partial }])
      else { updateChat(id, previous, attached); setDrafts(items => ({ ...items, [id]: next[next.length - 1].content })) }
    } finally {
      jobs.current.delete(id)
      if (alive.current) refreshJobs(version => version + 1)
    }
  }
  return <section className="view active ai-view" aria-label="AI 对话">
    <aside className="ai-history" aria-label="历史对话">
      <div className="ai-history-heading"><span>我的对话</span><Tag bordered={false}>{chats.length}</Tag></div>
      <Button type="primary" block className="ai-new-chat" disabled={!historyReady} icon={<Plus size={16} />} onClick={newChat}>新建对话</Button>
      <Input className="ai-history-search" prefix={<Search size={14} />} allowClear aria-label="搜索历史对话" placeholder="搜索历史对话" value={historySearch} onChange={event => setHistorySearch(event.target.value)} />
      <Button disabled={!root || !selected || activeBusy || !historyReady} onClick={() => setProfileOpen(true)}>人物分析</Button>
      <Button disabled={!root} onClick={() => setMemoryOpen(true)}>长期记忆</Button>
      <div className="ai-history-label">历史对话</div>
      <nav className="ai-history-list">{!visibleChats.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={!historyReady ? "正在读取本地对话…" : chats.length ? "没有匹配的对话" : "开始提问，留下你的第一段对话"} />}{visibleChats.map(chat => <div className={`ai-history-row${activeId === chat.id ? ' active' : ''}`} key={chat.id}>
        {renamingId === chat.id ? <Input className="ai-history-rename-input" aria-label="会话名称" autoFocus maxLength={80} value={renameTitle} onFocus={event => event.currentTarget.select()} onChange={event => setRenameTitle(event.target.value)} onBlur={() => saveRename(chat.id)} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
          if (event.key === 'Escape') { event.preventDefault(); cancelRename.current = true; event.currentTarget.blur() }
        }} /> : <button className="ai-history-open" aria-current={activeId === chat.id ? 'page' : undefined} title={chat.title} onClick={() => setActiveId(chat.id)}><MessageSquare size={15} /><span>{chat.title || '新对话'}</span>{jobs.current.has(chat.id) && <LoaderCircle className="ai-send-spinner" size={13} aria-label="正在生成" />}</button>}
        <button className="ai-history-rename" aria-label={`重命名对话：${chat.title}`} title="重命名" onClick={() => { cancelRename.current = false; setRenamingId(chat.id); setRenameTitle(chat.title) }}><Pencil size={14} /></button>
        <button className="ai-history-delete" aria-label={`删除对话：${chat.title}`} title="删除对话" disabled={jobs.current.has(chat.id)} onClick={() => { setChats(items => items.filter(item => item.id !== chat.id)); if (activeId === chat.id) newChat() }}><Trash2 size={14} /></button>
      </div>)}</nav><small><ShieldCheck size={14} />会话保存在本机，按微信账号区分</small>
    </aside>
    <div className="ai-main">
    <header className="ai-header"><div><div className="ai-header-title"><b>AI 对话</b><span>从聊天记录中找到答案</span></div></div><Badge status={root ? "success" : "default"} text={root ? "已连接本地记录" : "未连接微信"} /><ActionButton className="btn sm" disabled={busy} onClick={() => setKnowledgeOpen(true)}><Settings2 size={14} />设置</ActionButton></header>
    <div className="ai-messages" role="log" aria-live="polite">
      {!turns.length && <div className="ai-welcome"><h2>根据会话提问</h2></div>}
      {turns.map((turn, index) => <div key={index} className={`ai-message-row ${turn.role}`}><article className={`ai-turn ${turn.role}`} tabIndex={turn.role === 'user' ? 0 : undefined}>{turn.role === 'assistant' && <div className="ai-answer-label"><Avatar size={25} className="ai-brand-avatar" icon={<Sparkles size={14} />} /><b>WeTrace AI</b></div>}<div className="ai-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: props => <a {...props} target="_blank" rel="noreferrer" />, img: () => <span>[图片]</span> }}>{turn.content}</ReactMarkdown></div><MessageActions turn={turn} root={root} /></article></div>)}
      {activeBusy && <article className="ai-turn assistant" aria-busy="true"><div className="ai-working"><LoaderCircle className="ai-send-spinner" size={16} aria-hidden="true" /><b>AI</b><span role="status">{progress}</span><time aria-label={`已等待${elapsed}秒`}>{elapsed}s</time></div>{streaming && <div className="ai-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: props => <a {...props} target="_blank" rel="noreferrer" />, img: () => <span>[图片]</span> }}>{streaming}</ReactMarkdown></div>}<p className="ai-wait-note">处理时间取决于聊天记录数量和模型响应速度，数据越多，等待时间越长。你可以随时停止生成，或在问题中指定时间范围。</p></article>}
      {error && <Alert className="ai-request-error" type="error" showIcon title="AI 回答失败" description={error} role="alert" />}
      {storageError && <Alert type="warning" showIcon title={storageError} />}<div ref={bottom} />
    </div>
    <div className="ai-input-area">
      <div className="ai-context-toolbar">
        <span className="ai-context-label">已选会话：</span>
        <div className="ai-context-picker">
        <span className="ai-context-width" aria-hidden="true">{shownContext?.conversationName ?? '按问题查找会话'}</span>
        <Select className="ai-context-select" aria-label="选择问答会话" variant="borderless"
          placement="topLeft"
          showSearch={{ searchValue: conversationSearch, onSearch: setConversationSearch, filterOption: false }}
          onOpenChange={() => setConversationSearch('')}
          getPopupContainer={trigger => trigger.parentElement!} classNames={{ popup: { root: 'ai-context-dropdown' } }} loading={loadingConversations}
          disabled={activeBusy} value={shownContext?.conversationId ?? ''}
          onChange={id => selectConversation(id ? selectableConversations.find(item => item.id === id) : undefined)}
          options={[{ value: '', label: '按问题查找会话', avatar: undefined }, ...selectableConversations.filter(item => item.name.toLocaleLowerCase().includes(conversationSearch.trim().toLocaleLowerCase())).map(item => ({ value: item.id, label: item.name, avatar: item.avatar }))]}
          optionRender={option => option.value ? <div className="ai-conversation-option"><Avatar shape="square" size={32} src={option.data.avatar}>{String(option.label ?? '').slice(0, 1)}</Avatar><span>{option.label}</span></div> : option.label}
          styles={{ popup: { root: { minWidth: 300 } } }} listHeight={280}
          notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loadingConversations ? '正在加载会话…' : '没有匹配的会话'} />} />
        </div>
        {conversationLoadError && <span className="ai-context-load-error" role="status">{conversationLoadError}</span>}
      </div>
      <form className="ai-composer" onClick={event => {
        const target = event.target
        if (target instanceof HTMLElement && !target.closest('button, input, textarea, select, a, .ant-select, .ant-select-dropdown, .ant-dropdown, [role="combobox"]')) questionInput.current?.focus()
      }} onSubmit={event => { event.preventDefault(); void send() }}>
      {!root && <p>请先在设置中连接微信并同步聊天记录。</p>}
      {!available.length && <p>请先<ActionButton type="button" className="btn sm" onClick={onSettings}>配置语言模型</ActionButton></p>}
      <Input.TextArea ref={questionInput} variant="borderless" autoSize={{ minRows: 1, maxRows: 6 }} aria-label="向 AI 提问" value={question} maxLength={12000} disabled={activeBusy || !historyReady} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
      <div className="ai-composer-footer">
        <Dropdown trigger={['click']} placement="topRight" disabled={activeBusy || !available.length}
          menu={{ selectable: true, selectedKeys: selected ? [selected.id] : [], onClick: ({ key }) => setModelId(key), items: available.map(model => ({ key: model.id, label: model.name || model.model })) }}>
          <Button className="ai-model-select" type="text" htmlType="button" aria-label="对话模型" disabled={activeBusy || !available.length} onClick={event => event.stopPropagation()}>{selected?.name || selected?.model || '选择模型'}<ChevronDown size={14} /></Button>
        </Dropdown>
        <div className="ai-send-actions">{activeBusy && <Button className="ai-send ai-stop" htmlType="button" aria-label="停止生成" title="停止生成" onClick={() => { if (activeJob) void window.wetrace.cancelAi(activeJob.requestId) }}><Square size={14} fill="currentColor" /></Button>}<Button className="ai-send" type="primary" htmlType="submit" aria-label={activeBusy ? '正在整理回答' : '发送消息'} title={activeBusy ? '正在整理回答' : '发送消息'} disabled={activeBusy || !historyReady || !root || !selected || !question.trim()}>{activeBusy ? <LoaderCircle className="ai-send-spinner" size={18} /> : <ArrowUp size={20} strokeWidth={2.2} />}</Button></div>
      </div>
    </form>
    </div>
    </div>
    {profileOpen && root && <AiProfileDialog root={root} conversations={selectableConversations} initialId={context?.conversationId} onClose={() => setProfileOpen(false)} onStart={profile => { setProfileOpen(false); void send(profile) }} />}
    {memoryOpen && root && <AiMemoryPanel key={root} root={root} onClose={() => setMemoryOpen(false)} />}
    {knowledgeOpen && createPortal(<AiKnowledgePanel onClose={() => setKnowledgeOpen(false)} />, document.body)}
  </section>
}
