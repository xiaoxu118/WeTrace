import { Alert, Button, Input, Modal, Select, Space } from 'antd'
import { useEffect, useState } from 'react'
import type { AiProfileRequest } from '../../../shared/ai-chat'
import type { ConversationOption } from '../../../shared/types'

const localDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export function AiProfileDialog({ root, conversations, initialId, onStart, onClose }: { root: string; conversations: ConversationOption[]; initialId?: string; onStart: (profile: AiProfileRequest) => void; onClose: () => void }) {
  const [conversationId, setConversationId] = useState(initialId)
  const [timeRange, setTimeRange] = useState<'all' | 'dates'>('all')
  const [startDate, setStartDate] = useState(localDay(new Date()))
  const [endDate, setEndDate] = useState(localDay(new Date()))
  const [members, setMembers] = useState<{ id: string; name: string; count: number; isSelf?: boolean }[]>([])
  const [memberId, setMemberId] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const conversation = conversations.find(item => item.id === conversationId)
  const isGroup = conversation?.type === 'group'
  useEffect(() => {
    let active = true
    setMembers([]); setMemberId(undefined); setError(''); setLoading(false)
    if (!root || !conversationId || !isGroup) return
    if (timeRange === 'dates' && (!startDate || !endDate || startDate > endDate)) return
    setLoading(true)
    void (async () => {
      let start = startDate, end = endDate
      if (timeRange === 'all') {
        const summary = await window.wetrace.queryConversationSummary({ root, conversationId })
        if (!summary.ok) throw new Error(summary.error)
        if (summary.data.firstAt === null || summary.data.lastAt === null) throw new Error('该会话没有可读取的记录')
        start = localDay(new Date(summary.data.firstAt)); end = localDay(new Date(summary.data.lastAt))
      }
      const response = await window.wetrace.querySpeechStats({ root, conversationId, startDate: start, endDate: end })
      if (!response.ok) throw new Error(response.error)
      if (active) setMembers(response.data.members.filter(member => member.id && member.count > 0).map(member => ({ ...member, name: member.name === member.id || /^wxid[_-]/i.test(member.name) ? '该成员' : member.name })))
    })().catch(error => { if (active) setError(error instanceof Error ? error.message : '读取成员失败') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [root, conversationId, isGroup, timeRange, startDate, endDate])
  const member = members.find(item => item.id === memberId)
  return <Modal title="人物分析" open onCancel={onClose} footer={null}>
    <Space orientation="vertical" style={{ width: '100%' }}>
      <label>会话<Select aria-label="人物分析会话" style={{ width: '100%' }} showSearch optionFilterProp="label" value={conversationId} onChange={setConversationId} options={conversations.map(item => ({ value: item.id, label: item.name }))} /></label>
      <label>时间范围<Select aria-label="人物分析时间范围" style={{ width: '100%' }} value={timeRange} onChange={setTimeRange} options={[{ value: 'all', label: '全部本地历史' }, { value: 'dates', label: '指定日期' }]} /></label>
      {timeRange === 'dates' && <Space><Input type="date" aria-label="分析开始日期" value={startDate} onChange={event => setStartDate(event.target.value)} /><Input type="date" aria-label="分析结束日期" value={endDate} onChange={event => setEndDate(event.target.value)} /></Space>}
      {isGroup ? <label>人物<Select aria-label="人物分析成员" style={{ width: '100%' }} loading={loading} disabled={loading} showSearch optionFilterProp="label" value={memberId} onChange={setMemberId} placeholder="选择分析人物" options={members.map((item, index) => ({ value: item.id, label: `${item.name}${members.filter(other => other.name === item.name).length > 1 ? `（同名成员 ${index + 1}）` : ''} · ${item.count} 条发言` }))} /></label> : conversation && <span>分析对象：{conversation.name}</span>}
      {error && <Alert type="error" title={error} />}
      <Button type="primary" disabled={!conversation || loading || Boolean(error) || (isGroup && !member) || (timeRange === 'dates' && (!startDate || !endDate || startDate > endDate))} onClick={() => { if (conversation) onStart({ conversationId: conversation.id, targetName: isGroup ? member!.name : conversation.name, memberId: isGroup ? member!.id : undefined, isSelf: isGroup ? member!.isSelf === true : undefined, timeRange, startDate, endDate }) }}>开始分析</Button>
    </Space>
  </Modal>
}
