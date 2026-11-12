import { useEffect, useState } from 'react'
import { Alert, Button, Segmented, Spin, Statistic, Table } from 'antd'
import { Copy } from 'lucide-react'
import type { SyncConversation, SpeechStatsResult } from '../../../shared/types'
import { formatSpeechStats } from '../../../shared/speech-stats'
import { AnalysisFilters } from './AnalysisFilters'
import { SafeText } from './SafeText'
import { localDay } from '../../../shared/chat-patterns'

export function SpeechAnalysis({ conversation, root }: { conversation: SyncConversation; root?: string }) {
  const [start, setStart] = useState(() => localDay(Date.now()))
  const [end, setEnd] = useState(() => localDay(Date.now()))
  const [stats, setStats] = useState<SpeechStatsResult>({ total: 0, members: [], silentMembers: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'active' | 'silent'>('active')
  const [copyState, setCopyState] = useState('')
  const [retry, setRetry] = useState(0)
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
  return <div className="speech-body">
    <AnalysisFilters start={start} end={end} onRangeChange={(from, to) => { setStart(from); setEnd(to) }} allowAll presets={[{ label: '全部时间', days: null }, { label: '今天', days: 1 }, { label: '近 7 天', days: 7 }, { label: '近 30 天', days: 30 }]} />
    <div aria-live="polite">{invalid ? <Alert type="error" title="开始日期不能晚于结束日期" /> : loading ? <div className="analysis-loading"><Spin /></div> : error ? <Alert type="error" title={error} action={<Button size="small" onClick={() => setRetry(value => value + 1)}>重试</Button>} /> : <>
      <div className="analysis-totals"><Statistic title="发言总数" value={stats.total} suffix="条" /><Statistic title="发言人数" value={stats.members.length} suffix="人" /><Statistic title="未发言人数" value={stats.silentMembers?.length ?? '—'} suffix="人" /></div>
      <div className="speech-toolbar"><Segmented<'active' | 'silent'> className="speech-tabs" aria-label="统计名单" value={tab} onChange={setTab} options={[{ label: '发言排行', value: 'active' }, { label: '未发言成员', value: 'silent' }]} /><Button icon={<Copy size={14} />} onClick={() => void copyStats()}>复制统计</Button></div>
      {copyState && <p role="status">{copyState}</p>}
      {tab === 'silent' && stats.silentMembers === null ? <Alert type="error" title="未发言名单暂不可用" description={stats.membershipError || '无法读取当前群成员'} action={<Button size="small" onClick={() => setRetry(value => value + 1)}>重试</Button>} /> : <div className="speech-ranking"><Table<{ id: string; name: string; count?: number }> rowKey="id" size="small" pagination={false} scroll={{ y: 320 }} dataSource={tab === 'silent' ? stats.silentMembers ?? [] : stats.members} columns={[
        { title: tab === 'silent' ? '序号' : '排名', width: 64, render: (_value: unknown, _member: unknown, index: number) => index + 1 },
        { title: '群成员', dataIndex: 'name', render: (name: string) => <SafeText>{name}</SafeText> },
        ...(tab === 'silent' ? [] : [
          { title: '发言数', dataIndex: 'count', width: 96, render: (count: number) => count.toLocaleString() },
          { title: '占比', width: 96, render: (_value: unknown, member: { count?: number }) => stats.total ? `${((member.count ?? 0) / stats.total * 100).toFixed(1)}%` : '0%' },
        ]),
      ]} /></div>}
    </>}</div>
  </div>
}
