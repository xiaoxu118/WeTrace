import { useEffect, useRef, useState } from 'react'
import { Copy, X } from 'lucide-react'
import type { SyncConversation, SpeechStatsResult } from '../../../shared/types'
import { formatSpeechStats, silentMembersNote } from '../../../shared/speech-stats'
import { SafeText } from './SafeText'

function dateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function SpeechAnalysis({ conversation, root, onClose }: { conversation: SyncConversation; root?: string; accountName: string; onClose: () => void }) {
  const [start, setStart] = useState(() => dateValue(new Date()))
  const [end, setEnd] = useState(() => dateValue(new Date()))
  const [stats, setStats] = useState<SpeechStatsResult>({ total: 0, members: [], silentMembers: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'active' | 'silent'>('active')
  const [copyState, setCopyState] = useState('')
  const [retry, setRetry] = useState(0)
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => {
    if (start && end && start > end) return
    let active = true
    setLoading(true)
    setError('')
    setCopyState('')
    void window.wetrace.querySpeechStats({ root, conversationId: conversation.id, startDate: start, endDate: end }).then(response => {
      if (!active) return
      if (!response.ok) { setError(response.error); return }
      setStats(response.data)
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '读取记录失败') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [root, conversation.id, start, end, retry])
  const invalid = Boolean(start && end && start > end)
  async function copyStats() {
    try {
      await navigator.clipboard.writeText(formatSpeechStats(conversation.name, start, end, stats))
      setCopyState('已复制')
    } catch { setCopyState('复制失败，请重试') }
  }
  function preset(days: number) {
    const today = new Date()
    setEnd(dateValue(today))
    today.setDate(today.getDate() - days + 1)
    setStart(dateValue(today))
  }
  return <div className="modal-mask" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="modal speech-analysis" role="dialog" aria-modal="true" aria-labelledby="speech-title" tabIndex={-1} ref={dialog} onKeyDown={event => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab') {
        const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
        const first = controls?.[0], last = controls?.[controls.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <div className="modal-head"><div><h3 id="speech-title">发言分析 · <SafeText>{conversation.name}</SafeText></h3><p>按群聊和日期统计本地记录，系统通知不计入发言。</p></div><button className="icon-btn" aria-label="关闭发言分析" onClick={onClose}><X size={18} /></button></div>
      <div className="speech-body">
        <div className="speech-presets"><button onClick={() => { setStart(''); setEnd('') }}>全部时间</button><button onClick={() => preset(1)}>今天</button><button onClick={() => preset(7)}>近 7 天</button><button onClick={() => preset(30)}>近 30 天</button></div>
        <div className="speech-dates"><label>开始日期<input type="date" value={start} max={end || undefined} onChange={event => setStart(event.target.value)} /></label><span>至</span><label>结束日期<input type="date" value={end} min={start || undefined} onChange={event => setEnd(event.target.value)} /></label></div>
        <div aria-live="polite">{invalid ? <p role="alert">开始日期不能晚于结束日期</p> : loading ? <p>正在统计发言记录…</p> : error ? <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>重试</button></p> : <>
          <div className="speech-totals"><span>发言总数 <b>{stats.total.toLocaleString()}</b> 条</span><span>发言人数 <b>{stats.members.length.toLocaleString()}</b> 人</span><span>未发言 <b>{stats.silentMembers?.length.toLocaleString() ?? '—'}</b> 人</span></div>
          <div className="speech-toolbar"><div className="speech-tabs" role="group" aria-label="统计名单"><button aria-pressed={tab === 'active'} onClick={() => setTab('active')}>发言排行</button><button aria-pressed={tab === 'silent'} onClick={() => setTab('silent')}>未发言成员</button></div><button className="speech-copy" onClick={() => void copyStats()}><Copy size={14} />复制统计</button></div>
          {copyState && <p role="status">{copyState}</p>}
          {tab === 'silent' ? stats.silentMembers === null ? <p role="alert">未发言名单暂不可用：{stats.membershipError || '无法读取当前群成员'} <button onClick={() => setRetry(value => value + 1)}>重试</button></p> : stats.silentMembers.length ? <div className="speech-ranking"><table><thead><tr><th>序号</th><th>未发言成员</th></tr></thead><tbody>{stats.silentMembers.map((member, index) => <tr key={member.id}><td>{index + 1}</td><td><SafeText>{member.name}</SafeText></td></tr>)}</tbody></table></div> : <p className="empty-search">当前群成员在该时间范围内均有发言记录</p> : <>
          {stats.total ? <div className="speech-ranking"><table><thead><tr><th>排名</th><th>群成员</th><th>发言数</th><th>占比</th></tr></thead><tbody>{stats.members.map((member, index) => <tr key={member.id}><td>{index + 1}</td><td><SafeText>{member.name}</SafeText></td><td>{member.count.toLocaleString()}</td><td>{(member.count / stats.total * 100).toFixed(1)}%</td></tr>)}</tbody></table></div> : <p className="empty-search">该时间范围内没有发言记录</p>}</>}
          <p className="speech-note">{silentMembersNote}</p>
        </>}</div>
      </div>
    </div>
  </div>
}
