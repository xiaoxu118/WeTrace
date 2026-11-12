import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Spin, Statistic } from 'antd'
import { AnalysisFilters } from './AnalysisFilters'
import type { SyncConversation, SyncMessage } from '../../../shared/types'
import { analyzePatterns, localDay } from '../../../shared/chat-patterns'
import { reportMemberKey, reportMemberName } from '../../../shared/report-messages'
import { SafeText } from './SafeText'

export function ChatPatterns({ conversation, root }: { conversation: SyncConversation; root?: string }) {
  const [messages, setMessages] = useState<SyncMessage[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [member, setMember] = useState(''), [end, setEnd] = useState(() => localDay(Date.now())), [start, setStart] = useState(() => localDay(Date.now()))
  const [evidence, setEvidence] = useState<SyncMessage[]>([]), [evidenceDay, setEvidenceDay] = useState(''), [evidenceError, setEvidenceError] = useState(''), [reading, setReading] = useState(false)
  const [hoveredDay, setHoveredDay] = useState<{ date: string; count: number; left: number } | null>(null)
  const timeline = useRef<HTMLDivElement>(null)
  const request = useRef(0)
  useEffect(() => () => { request.current++ }, [])
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
  return <div className="speech-body patterns-body">
    <AnalysisFilters start={start} end={end} onRangeChange={(from, to) => { setStart(from); setEnd(to) }} member={member} members={members} onMemberChange={setMember} presets={[{ label: '今天', days: 1 }, { label: '近 90 天', days: 90 }, { label: '近 180 天', days: 180 }, { label: '近 365 天', days: 365 }]} />
    <div aria-live="polite">{loading ? <div className="analysis-loading"><Spin /></div> : error ? <p role="alert">{error} <Button size="small" onClick={() => setRetry(n => n + 1)}>重试</Button></p> : !start || !end || start > end ? <p role="alert">请选择有效的起止日期。</p> : <><div className="analysis-totals"><Statistic title="观察对象" value={subjectName} /><Statistic title="消息数" value={result.total} suffix="条" /><Statistic title="活跃天数" value={result.days.filter(d => d.count).length} suffix="天" /></div>
    <div className="patterns-chart" ref={timeline}>
      {hoveredDay && <div id="patterns-day-tooltip" className="patterns-day-tooltip" role="tooltip" style={{ left: hoveredDay.left }}>{hoveredDay.date} · {hoveredDay.count.toLocaleString()} 条消息</div>}
      <div className="patterns-timeline" aria-label="每日消息量" onMouseLeave={() => setHoveredDay(null)} onScroll={() => setHoveredDay(null)}>{result.days.map(d => <Button type="text" className="patterns-day" key={d.date} aria-label={`${d.date}，${d.count} 条消息`} aria-describedby={hoveredDay?.date === d.date ? 'patterns-day-tooltip' : undefined} onMouseEnter={event => {
        const bounds = timeline.current?.getBoundingClientRect(), bar = event.currentTarget.getBoundingClientRect()
        if (bounds) setHoveredDay({ date: d.date, count: d.count, left: Math.max(100, Math.min(bounds.width - 100, bar.left + bar.width / 2 - bounds.left)) })
      }} onFocus={event => {
        const bounds = timeline.current?.getBoundingClientRect(), bar = event.currentTarget.getBoundingClientRect()
        if (bounds) setHoveredDay({ date: d.date, count: d.count, left: Math.max(100, Math.min(bounds.width - 100, bar.left + bar.width / 2 - bounds.left)) })
      }} onBlur={() => setHoveredDay(null)} onClick={() => void readDay(d.date)}><span className="patterns-bar" style={{ height: `${Math.max(3, d.count / peakCount * 72)}px` }} /></Button>)}</div>
    </div>
    {result.findings.length ? result.findings.map(f => <article className="pattern-card" key={`${member}:${f.id}`}><small><SafeText>{subjectName}</SafeText> · {f.date || '日常规律'}</small><h4>{f.title}</h4><p>{f.detail}</p>{f.date && <Button type="link" onClick={() => void readDay(f.date)}>查看当天聊天</Button>}</article>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无明显变化" />}
    {evidenceDay && <section className="patterns-evidence"><h4><SafeText>{subjectName}</SafeText> · {evidenceDay} 的聊天</h4>{reading ? <p>正在读取…</p> : evidenceError ? <p role="alert">{evidenceError} <Button size="small" onClick={() => void readDay(evidenceDay)}>重试</Button></p> : evidence.length ? evidence.slice(0, 300).map(m => <p key={m.id}><small>{m.time} · <SafeText>{reportMemberName(m)}</SafeText></small><br /><SafeText>{m.text || '[非文字消息]'}</SafeText></p>) : <p>当天没有可展示的消息。</p>}{evidence.length > 300 && <p>仅展示前 300 条，共 {evidence.length} 条。</p>}</section>}
    </>}</div>
  </div>
}
