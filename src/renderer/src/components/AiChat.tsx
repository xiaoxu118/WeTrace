import { AiKnowledgePanel } from './AiKnowledgePanel'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ChevronDown, Cpu, LoaderCircle, Sparkles, Plus, MessageSquare, Trash2, Square, Pencil, Settings2 } from 'lucide-react'
import type { ModelConfig, SyncConversation } from '../../../shared/types'
import type { AiChatTurn, AiChatContext, AiConversationLaunch } from '../../../shared/ai-chat'

interface SavedChat { id: string; title: string; turns: AiChatTurn[]; context?: AiChatContext; updatedAt: number; pending?: boolean }
function readChats(key: string): SavedChat[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter(item => typeof item.id === 'string' && typeof item.title === 'string' && Array.isArray(item.turns) && item.turns.every((turn: AiChatTurn) => ['user', 'assistant'].includes(turn.role) && typeof turn.content === 'string')).map(item => ({ ...item, context: item.context && typeof item.context.conversationId === 'string' && typeof item.context.conversationName === 'string' ? { conversationId: item.context.conversationId, conversationName: item.context.conversationName } : undefined })) : []
  } catch { return [] }
}

export function AiChat({ root, conversations, models, onSettings, launch, onBusyChange }: { root?: string; conversations: SyncConversation[]; models: ModelConfig[]; onSettings: () => void; launch?: AiConversationLaunch; onBusyChange?: (busy: boolean) => void }) {
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const storageKey = `wetrace:ai-chats:${root ?? 'none'}`
  const [chats, setChats] = useState<SavedChat[]>(() => readChats(storageKey))
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const cancelRename = useRef(false)
  function saveRename(id: string) {
    if (!cancelRename.current && renameTitle.trim()) setChats(items => items.map(item => item.id === id ? { ...item, title: renameTitle.trim() } : item))
    setRenamingId(null)
  }
  const [activeId, setActiveId] = useState<string | null>(() => {
    try { const id = localStorage.getItem(`${storageKey}:active`); return chats.some(chat => chat.id === id) ? id : null } catch { return null }
  })
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const savedTurns = chats.find(chat => chat.id === activeId)?.turns ?? []
  const turns = generatingId === activeId && chats.find(chat => chat.id === activeId)?.pending && savedTurns.at(-1)?.role === 'assistant' ? savedTurns.slice(0, -1) : savedTurns
  const [storageError, setStorageError] = useState('')
  const [progress, setProgress] = useState('正在理解问题…')
  const [elapsed, setElapsed] = useState(0)
  const [streaming, setStreaming] = useState('')
  const request = useRef<string | null>(null)
  const partial = useRef('')
  const liveJob = useRef<{ id: string; turns: AiChatTurn[] } | null>(null)
  const sending = useRef(false)
  useEffect(() => {
    try { if (activeId) localStorage.setItem(`${storageKey}:active`, activeId); else localStorage.removeItem(`${storageKey}:active`) } catch { /* history persistence reports storage errors */ }
  }, [activeId, storageKey])
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(chats)); setStorageError('') }
    catch { setStorageError('本地保存失败，存储空间可能不足，请删除不需要的会话。') }
  }, [chats, storageKey])
  useEffect(() => {
    const unprogress = window.wetrace.onAiProgress(event => { if (event.requestId === request.current) setProgress(event.detail) })
    const unsubscribe = window.wetrace.onAiDelta(delta => {
      if (delta.requestId === request.current) { partial.current += delta.text; setStreaming(partial.current) }
    })
    return () => { unprogress(); unsubscribe(); if (request.current) void window.wetrace.cancelAi(request.current) }
  }, [])
  useEffect(() => {
    const timer = window.setInterval(() => {
      const job = liveJob.current
      if (!job || !partial.current || !request.current) return
      const text = partial.current
      setChats(items => items.map(chat => chat.id === job.id ? { ...chat, pending: true, turns: [...job.turns, { role: 'assistant', content: text }] } : chat))
    }, 500)
    return () => window.clearInterval(timer)
  }, [])
  function newChat() { setActiveId(null) }
  function updateChat(id: string, next: AiChatTurn[], context?: AiChatContext) {
    setChats(items => {
      const existing = items.find(item => item.id === id)
      return [{ id, title: existing?.title ?? (context ? `与${context.conversationName}的聊天` : next[0]?.content.slice(0, 36) || '新对话'), turns: next, context: context ?? existing?.context, updatedAt: Date.now() }, ...items.filter(item => item.id !== id)]
    })
  }
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const question = drafts[activeId ?? 'new'] ?? ''
  function setQuestion(value: string) { setDrafts(items => ({ ...items, [activeId ?? 'new']: value })) }
  const [modelId, setModelId] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!busy) return
    const started = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [busy])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const error = errors[activeId ?? 'new'] ?? ''
  const activeBusy = busy && generatingId === activeId
  const bottom = useRef<HTMLDivElement>(null)
  const available = models.filter(model => model.kind === 'text' && model.source === 'remote')
  const selected = available.find(model => model.id === modelId) ?? available.find(model => model.isDefault) ?? available[0]
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [activeId, turns, activeBusy, error, activeBusy ? streaming : null])
  const consumedLaunch = useRef<string | null>(null)
  const context = chats.find(chat => chat.id === activeId)?.context
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false) }, [busy, onBusyChange])
  useEffect(() => {
    if (!launch || launch.root !== root || consumedLaunch.current === launch.id || !root) return
    consumedLaunch.current = launch.id
    const existing = chats.find(chat => chat.context?.conversationId === launch.context.conversationId)
    const id = existing?.id ?? crypto.randomUUID()
    setActiveId(id)
    if (!existing) updateChat(id, [], launch.context)
  }, [launch?.id, root])
  const shownContext = context
  async function send() {
    const prompt = question.trim()
    const previous = turns
    const attached = context
    if (sending.current || !prompt || !root || !selected || previous.length >= 40) return
    const next: AiChatTurn[] = [...previous, { role: 'user', content: prompt }]
    const id = activeId ?? crypto.randomUUID()
    const requestId = crypto.randomUUID()
    sending.current = true; request.current = requestId; partial.current = ''; liveJob.current = { id, turns: next }
    setActiveId(id); setGeneratingId(id); updateChat(id, next, attached)
    setBusy(true); setElapsed(0); setProgress('正在理解问题…'); setErrors(items => ({ ...items, [id]: '' })); setDrafts(items => ({ ...items, [activeId ?? 'new']: '', [id]: '' })); setStreaming('')
    try {
      const response = await window.wetrace.askAi({ requestId, root, modelId: selected.id, conversations: conversations.map(({ id, name }) => ({ id, name })), turns: next, context: attached })
      if (!response.ok) throw new Error(response.error)
      updateChat(id, [...next, { role: 'assistant', content: response.answer }])
    } catch (err) {
      setErrors(items => ({ ...items, [id]: err instanceof Error ? err.message : '请求失败，请重试' }))
      if (partial.current) updateChat(id, [...next, { role: 'assistant', content: `${partial.current}\n\n> 回答未完成：${err instanceof Error ? err.message : '请求中断'}` }])
      else { updateChat(id, previous, attached); setDrafts(items => ({ ...items, [id]: next[next.length - 1].content })) }
    } finally { liveJob.current = null; sending.current = false; request.current = null; setBusy(false); setGeneratingId(null); setStreaming('') }
  }
  return <section className="view active ai-view" aria-label="AI 对话">
    <aside className="ai-history" aria-label="历史对话">
      <button className="ai-new-chat" onClick={newChat}><Plus size={16} />新建对话</button>
      <div className="ai-history-label">历史对话</div>
      <nav className="ai-history-list">{!chats.length && <p>发送消息后，对话会保存在这里</p>}{chats.map(chat => <div className={`ai-history-row${activeId === chat.id ? ' active' : ''}`} key={chat.id}>
        {renamingId === chat.id ? <input className="ai-history-rename-input" aria-label="会话名称" autoFocus maxLength={80} value={renameTitle} onFocus={event => event.currentTarget.select()} onChange={event => setRenameTitle(event.target.value)} onBlur={() => saveRename(chat.id)} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
          if (event.key === 'Escape') { event.preventDefault(); cancelRename.current = true; event.currentTarget.blur() }
        }} /> : <button className="ai-history-open" aria-current={activeId === chat.id ? 'page' : undefined} title={chat.title} onClick={() => setActiveId(chat.id)}><MessageSquare size={15} /><span>{chat.title || '新对话'}</span>{busy && generatingId === chat.id && <LoaderCircle className="ai-send-spinner" size={13} aria-label="正在生成" />}</button>}
        <button className="ai-history-rename" aria-label={`重命名对话：${chat.title}`} title="重命名" onClick={() => { cancelRename.current = false; setRenamingId(chat.id); setRenameTitle(chat.title) }}><Pencil size={14} /></button>
        <button className="ai-history-delete" aria-label={`删除对话：${chat.title}`} title="删除对话" disabled={busy && generatingId === chat.id} onClick={() => { setChats(items => items.filter(item => item.id !== chat.id)); if (activeId === chat.id) newChat() }}><Trash2 size={14} /></button>
      </div>)}</nav><small>会话仅保存在此设备，按微信账号区分。</small>
    </aside>
    <div className="ai-main">
    <header className="ai-header"><div><Sparkles size={20} /><b>AI 对话</b><span>从聊天记录中找到答案</span></div><button className="btn sm" disabled={busy} onClick={() => setKnowledgeOpen(true)}><Settings2 size={14} />设置</button></header>
    <div className="ai-messages" role="log" aria-live="polite">
      {!turns.length && <div className="ai-welcome"><Sparkles size={36} /><h2>想了解聊天里的什么？</h2><p>告诉我群聊、人物和时间，我来帮你梳理。</p><button onClick={() => setQuestion(context ? '最近3天小明都聊了些什么？' : '在「群聊名称」群里，最近3天小明都聊了些什么？')}>最近 3 天，小明在群里聊了些什么？</button><button onClick={() => setQuestion(context ? '总结最近7天讨论的重点' : '总结「群聊名称」群最近7天讨论的重点')}>帮我总结群聊最近一周的讨论重点</button></div>}
      {turns.map((turn, index) => <article key={index} className={`ai-turn ${turn.role}`}>{turn.role === 'assistant' && <b>AI</b>}<div className="ai-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: props => <a {...props} target="_blank" rel="noreferrer" />, img: () => <span>[图片]</span> }}>{turn.content}</ReactMarkdown></div></article>)}
      {activeBusy && <article className="ai-turn assistant" aria-busy="true"><div className="ai-working"><LoaderCircle className="ai-send-spinner" size={16} aria-hidden="true" /><b>AI</b><span role="status">{progress}</span><time aria-label={`已等待${elapsed}秒`}>{elapsed}s</time></div>{streaming && <div className="ai-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: props => <a {...props} target="_blank" rel="noreferrer" />, img: () => <span>[图片]</span> }}>{streaming}</ReactMarkdown></div>}{elapsed >= 30 && <p className="ai-wait-note">仍在处理中，记录较多或模型响应较慢时需要更长时间。你可以随时停止生成。</p>}</article>}
      {storageError && <div className="ai-error" role="alert">{storageError}</div>}{error && <div className="ai-error" role="alert">{error}</div>}<div ref={bottom} />
    </div>
    {busy && !activeBusy && <div className="ai-background-job" role="status"><LoaderCircle className="ai-send-spinner" size={14} /><span>另一个会话正在生成回答，你可以查看记录或先编辑问题。</span><button type="button" onClick={() => setActiveId(generatingId)}>返回查看</button></div>}
    <div className="ai-input-area">{shownContext && <p className="ai-context-scope">已关联「{shownContext.conversationName}」，发送问题后按人物和时间范围查询记录。</p>}<form className="ai-composer" onSubmit={event => { event.preventDefault(); void send() }}>
      {!root && <p>请先在设置中连接微信并同步聊天记录。</p>}
      {!available.length && <p>请先<button type="button" className="btn sm" onClick={onSettings}>配置语言模型</button></p>}
      <textarea aria-label="向 AI 提问" value={question} maxLength={12000} disabled={activeBusy} onChange={event => setQuestion(event.target.value)} placeholder="例如：产品讨论群，最近3天小明都聊了些什么？" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
      <div className="ai-composer-footer">
        <div className="ai-model-picker">
          <Cpu size={15} aria-hidden="true" />
          <span>{selected?.name || selected?.model || '选择模型'}</span>
          <ChevronDown size={13} aria-hidden="true" />
          <select aria-label="对话模型" title={selected?.name || selected?.model || '选择模型'} value={selected?.id ?? ''} disabled={busy || !available.length} onChange={event => setModelId(event.target.value)}>
            {!available.length && <option value="">暂无可用模型</option>}
            {available.map(model => <option key={model.id} value={model.id}>{model.name || model.model}</option>)}
          </select>
        </div>
        <div className="ai-send-actions"><span className="ai-keyboard-hint">Enter 发送 · Shift + Enter 换行</span>{activeBusy && <button className="ai-send ai-stop" type="button" aria-label="停止生成" title="停止生成" onClick={() => { if (request.current) void window.wetrace.cancelAi(request.current) }}><Square size={14} fill="currentColor" /></button>}<button className="ai-send" type="submit" aria-label={activeBusy ? '正在整理回答' : '发送消息'} title={busy && !activeBusy ? '其他会话正在生成，请等待完成后发送' : activeBusy ? '正在整理回答' : '发送消息'} disabled={busy || !root || !selected || !question.trim() || turns.length >= 40}>{activeBusy ? <LoaderCircle className="ai-send-spinner" size={18} /> : <ArrowUp size={20} strokeWidth={2.2} />}</button></div>
      </div>
    </form>
      <small>相关聊天记录将发送给所选模型服务。回答基于本地可读取记录，未解析的媒体内容可能缺失。{turns.length >= 40 ? ' 对话已达上限，请新建对话。' : ''}</small>
    </div>
    </div>
    {knowledgeOpen && createPortal(<AiKnowledgePanel onClose={() => setKnowledgeOpen(false)} />, document.body)}
  </section>
}
