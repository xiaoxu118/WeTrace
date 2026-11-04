import { Alert, Button, Empty, Input, List, Modal, Space, Spin, Tag } from 'antd'
import { useEffect, useState } from 'react'
import type { AiQueryState } from '../../../shared/ai-chat'
import type { SyncMessage } from '../../../shared/types'

export function AiEvidenceDialog({ root, state, onClose }: { root: string; state: AiQueryState; onClose: () => void }) {
  const [messages, setMessages] = useState<SyncMessage[]>([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    const timer = window.setTimeout(() => { void window.wetrace.aiEvidence({ root, state, keyword: search, page }).then(response => {
      if (!response.ok) throw new Error(response.error)
      if (active) { setMessages(response.data.messages); setTotal(response.data.total) }
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : '读取原文失败') }).finally(() => { if (active) setLoading(false) }) }, 200)
    return () => { active = false; window.clearTimeout(timer) }
  }, [root, state.conversationId, state.startDate, state.endDate, retry, search, page])
  const privateChat = !state.conversationId.endsWith('@chatroom')
  const isTarget = (message: SyncMessage) => state.profileMemberId ? state.profileMemberIsSelf ? message.from === 'me' : message.from !== 'me' && message.senderId === state.profileMemberId : privateChat ? state.profileTarget === '我' ? message.from === 'me' : message.from === 'them' : message.sender === state.profileTarget
  return <Modal title="查看原话" open onCancel={onClose} footer={null} width={760}>
    <Space orientation="vertical" style={{ width: '100%' }}>
      <span>{state.startDate} 至 {state.endDate}</span>
      <Input.Search aria-label="搜索分析原文" placeholder="搜索原话或发言人" value={search} maxLength={500} onChange={event => { setSearch(event.target.value); setPage(1) }} allowClear />
      {error && <Alert type="error" title={error} action={<Button onClick={() => setRetry(value => value + 1)}>重试</Button>} />}
      {loading ? <Spin /> : !error && <List dataSource={messages} pagination={{ current: page, total, pageSize: 50, showSizeChanger: false, onChange: setPage }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到原文" /> }} renderItem={message => <List.Item><div><Space><b>{message.from === 'me' ? '我' : message.sender && message.sender !== message.senderId && !/^wxid[_-]/i.test(message.sender) ? message.sender : privateChat ? state.profileTarget || '对方' : '该成员'}</b><time>{new Date(message.createdAt).toLocaleString('zh-CN')}</time>{state.analysisType === 'profile' && <Tag>{isTarget(message) ? '本人发言' : '互动上下文'}</Tag>}</Space><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.text}</p></div></List.Item>} />}
    </Space>
  </Modal>
}
