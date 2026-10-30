import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { SyncConversation, SyncMessage } from '../../../shared/types'
import { analyzePatterns, localDay } from '../../../shared/chat-patterns'
import { reportMemberKey, reportMemberName } from '../../../shared/report-messages'
import { SafeText } from './SafeText'

export function ChatPatterns({ conversation, root, onClose }: { conversation: SyncConversation; root?: string; onClose: () => void }) {
  const [messages, setMessages] = useState<SyncMessage[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [member, setMember] = useState(''), [end, setEnd] = useState(() => localDay(Date.now())), [start, setStart] = useState(() => localDay(Date.now() - 179 * 86400000))
  const [evidence, setEvidence] = useState<SyncMessage[]>([]), [evidenceDay, setEvidenceDay] = useState(''), [evidenceError, setEvidenceError] = useState(''), [reading, setReading] = useState(false)
  const [hoveredDay, setHoveredDay] = useState<{ date: string; count: number; left: number } | null>(null)
  const timeline = useRef<HTMLDivElement>(null)
  const request = useRef(0), dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => { previous?.focus(); request.current++ }
  }, [])
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void window.wetrace.queryReportMessages({ root, conversationId: conversation.id, startDate: '1970-01-01', endDate: localDay(Date.now()), contentTypes: ['message', 'voice', 'image', 'video'], metadataOnly: true, deferMedia: true }).then(result => {
      if (!active) return
      if (result.ok) setMessages(result.data.messages)
      else setError(result.error)
    }).catch(e => { if (active) setError(String(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [root, conversation.id, retry])
  const members = useMemo(() => {
    const result = new Map<string, string>()
    for (const m of messages) { const key = reportMemberKey(m); if (key) result.set(key, reportMemberName(m)) }
    return [...result]
  }, [messages])
  const subjectName = member ? members.find(([key]) => key === member)?.[1] ?? '所选成员' : '整个会话'
  const result = useMemo(() => analyzePatterns(messages, start, end, member), [messages, start, end, member])
  const peakCount = Math.max(1, ...result.days.map(d => d.count))
  useEffect(() => { setHoveredDay(null); request.current++; setEvidenceDay(''); setEvidence([]); setReading(false); setEvidenceError('') }, [start, end, member])
  async function readDay(date: string) {
    const id = ++request.current
    setEvidenceDay(date); setEvidence([]); setReading(true); setEvidenceError('')
    try {
      const response = await window.wetrace.queryReportMessages({ root, conversationId: conversation.id, startDate: date, endDate: date, contentTypes: ['message', 'voice', 'image', 'video'], deferMedia: true })
      if (id !== request.current) return
      if (!response.ok) setEvidenceError(response.error)
      else setEvidence(response.data.messages.filter(m => !member || reportMemberKey(m) === member))
    } catch (e) { if (id === request.current) setEvidenceError(String(e)) }
    finally { if (id === request.current) setReading(false) }
  }
  return <div className="modal-mask" onClick={e => { if (e.target === e.currentTarget) onClose() }}><div className="modal patterns-modal" role="dialog" aria-modal="true" aria-labelledby="patterns-title" ref={dialog} tabIndex={-1} onKeyDown={e => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Tab') {
      const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select'), first = controls?.[0], last = controls?.[controls.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }
  }}><div className="modal-head"><div><h3 id="patterns-title">聊天脉络 · <SafeText>{conversation.name}</SafeText></h3><p>看看日常的规律，发现那些不寻常。</p></div><button className="icon-btn" aria-label="关闭聊天脉络" onClick={onClose}><X size={18} /></button></div>
    <div className="speech-body"><div className="patterns-filters"><label>观察对象<select value={member} onChange={e => setMember(e.target.value)}><option value="">整个会话</option>{members.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label>开始日期<input type="date" value={start} max={end} onChange={e => setStart(e.target.value)} /></label><label>结束日期<input type="date" value={end} min={start} max={localDay(Date.now())} onChange={e => setEnd(e.target.value)} /></label></div>
    <div className="speech-presets">{[90, 180, 365].map(days => <button key={days} onClick={() => { setStart(localDay(Date.now() - (days - 1) * 86400000)); setEnd(localDay(Date.now())) }}>近 {days} 天</button>)}</div>
    <div aria-live="polite">{loading ? <p>正在读取长期聊天记录…</p> : error ? <p role="alert">{error} <button onClick={() => setRetry(n => n + 1)}>重试</button></p> : !start || !end || start > end ? <p role="alert">请选择有效的起止日期。</p> : <><div className="speech-totals"><span>观察对象 <b><SafeText>{subjectName}</SafeText></b></span><span>消息 <b>{result.total.toLocaleString()}</b> 条</span><span>活跃 <b>{result.days.filter(d => d.count).length}</b> 天</span></div>
    <div className="patterns-chart" ref={timeline}>
      {hoveredDay && <div id="patterns-day-tooltip" className="patterns-day-tooltip" role="tooltip" style={{ left: hoveredDay.left }}>{hoveredDay.date} · {hoveredDay.count.toLocaleString()} 条消息</div>}
      <div className="patterns-timeline" aria-label="每日消息量" onMouseLeave={() => setHoveredDay(null)} onScroll={() => setHoveredDay(null)}>{result.days.map(d => <button key={d.date} aria-label={`${d.date}，${d.count} 条消息`} aria-describedby={hoveredDay?.date === d.date ? 'patterns-day-tooltip' : undefined} onMouseEnter={event => {
        const bounds = timeline.current?.getBoundingClientRect(), bar = event.currentTarget.getBoundingClientRect()
        if (bounds) setHoveredDay({ date: d.date, count: d.count, left: Math.max(100, Math.min(bounds.width - 100, bar.left + bar.width / 2 - bounds.left)) })
      }} onFocus={event => {
        const bounds = timeline.current?.getBoundingClientRect(), bar = event.currentTarget.getBoundingClientRect()
        if (bounds) setHoveredDay({ date: d.date, count: d.count, left: Math.max(100, Math.min(bounds.width - 100, bar.left + bar.width / 2 - bounds.left)) })
      }} onBlur={() => setHoveredDay(null)} onClick={() => void readDay(d.date)}><span style={{ height: `${Math.max(3, d.count / peakCount * 72)}px` }} /></button>)}</div>
    </div>
    {result.findings.length ? result.findings.map(f => <article className="pattern-card" key={`${member}:${f.id}`}><small><SafeText>{subjectName}</SafeText> · {f.date || '日常规律'}</small><h4>{f.title}</h4><p>{f.detail}</p>{f.date && <button onClick={() => void readDay(f.date)}>查看当天聊天</button>}</article>) : <p><SafeText>{subjectName}</SafeText>暂未发现明显变化。异常判断需要至少四周的历史参考；没有异常也可能意味着节律稳定。</p>}
    {evidenceDay && <section className="patterns-evidence"><h4><SafeText>{subjectName}</SafeText> · {evidenceDay} 的聊天</h4>{reading ? <p>正在读取…</p> : evidenceError ? <p role="alert">{evidenceError} <button onClick={() => void readDay(evidenceDay)}>重试</button></p> : evidence.length ? evidence.slice(0, 300).map(m => <p key={m.id}><small>{m.time} · <SafeText>{reportMemberName(m)}</SafeText></small><br /><SafeText>{m.text || '[非文字消息]'}</SafeText></p>) : <p>当天没有可展示的消息。</p>}{evidence.length > 300 && <p>仅展示前 300 条，共 {evidence.length} 条。</p>}</section>}
    <p className="speech-note">基于本地记录和本机时区；缺失记录也可能表现为沉默。凌晨发言不代表未睡。异常与此前最多 12 周的同星期日比较，变化描述不推断个人动机。</p></>}</div></div>
  </div></div>
}
