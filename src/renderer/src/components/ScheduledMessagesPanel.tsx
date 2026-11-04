import { Alert, Button, Input, List, Modal, Popconfirm, Select, Space, Switch, Tag } from 'antd'
import { useEffect, useState } from 'react'
import type { ConversationOption } from '../../../shared/types'
import type { SendTaskAction, SendTaskResponse } from '../../../shared/scheduled-messages'
const statusLabels = { draft:'待确认', scheduled:'等待发送', paused:'已暂停', sending:'正在发送', sent:'通道已确认', failed:'执行失败', unknown:'结果未知', cancelled:'已取消' }
export function ScheduledMessagesPanel({ root, visible }: { root: string; visible: boolean }) {
  const [result, setResult] = useState<Extract<SendTaskResponse, { ok: true }>>()
  const [recipients, setRecipients] = useState<ConversationOption[]>([])
  const [recipientId, setRecipientId] = useState<string>()
  const [content, setContent] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [logId, setLogId] = useState<string>()
  async function update(action: SendTaskAction, silent = false) {
    if (!silent) setBusy(true)
    try {
      const response = await window.wetrace.scheduledMessages(root, action)
      if (!response.ok) throw new Error(response.error)
      setResult(response); setError('')
      if (action.type === 'create') { setCreating(false); setContent(''); setDue('') }
    } catch (error) { setError(error instanceof Error ? error.message : '任务操作失败') }
    finally { if (!silent) setBusy(false) }
  }
  useEffect(() => { void update({ type:'load' }) }, [root])
  useEffect(() => {
    if (!visible) return
    let active = true
    void window.wetrace.listConversationOptions(root).then(response => { if (!response.ok) throw new Error(response.error); if (active) setRecipients(response.conversations.filter(item => item.type === 'group' || item.type === 'friend')) }).catch(error => { if (active) setError(error instanceof Error ? error.message : '读取接收方失败') })
    const timer = window.setInterval(() => void update({ type:'load' }, true), 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [root, visible])
  if (!visible) return null
  const logTask = result?.state.tasks.find(task => task.id === logId)
  return <section className="view active" aria-label="定时发送" style={{ display:visible?'block':'none', padding:24, overflow:'auto' }}>
    <Space orientation="vertical" style={{ width:'100%' }}>
      <Space><h2>定时发送</h2><Switch aria-label="启用定时发送" checked={result?.state.enabled ?? false} disabled={busy || !result || !result.capability.supported} onChange={enabled => void update({ type:'enable',enabled })} /><Button disabled={!result || busy} onClick={() => setCreating(true)}>创建任务</Button></Space>
      {result && !result.capability.supported && <Alert type="warning" title={result.capability.reason || '当前微信版本暂不支持发送'} />}
      {error && <Alert type="error" title={error} />}
      <List dataSource={result?.state.tasks ?? []} locale={{ emptyText:'暂无发送任务' }} renderItem={task => <List.Item><Space orientation="vertical" style={{ width:'100%' }}><Space><b>{task.recipientName}</b><time>{new Date(task.dueAt).toLocaleString('zh-CN')}</time><Tag>{statusLabels[task.status]}</Tag></Space><p style={{ whiteSpace:'pre-wrap' }}>{task.content}</p><Space>
        {task.status === 'draft' && <Popconfirm title="确认按指定时间向该接收方发送以上内容？" onConfirm={() => update({ type:'confirm',id:task.id })}><Button disabled={busy || !result?.state.enabled || !result.capability.supported}>确认发送</Button></Popconfirm>}
        {task.status === 'scheduled' && <Button disabled={busy} onClick={() => void update({ type:'pause',id:task.id })}>暂停</Button>}
        {task.status === 'paused' && <Button disabled={busy || !result?.state.enabled || !result.capability.supported} onClick={() => void update({ type:'resume',id:task.id })}>继续</Button>}
        {['draft','scheduled','paused'].includes(task.status) && <Button danger disabled={busy} onClick={() => void update({ type:'cancel',id:task.id })}>取消</Button>}
        <Button onClick={() => setLogId(task.id)}>执行日志</Button>
      </Space></Space></List.Item>} />
    </Space>
    <Modal title="创建定时发送任务" open={creating} onCancel={() => setCreating(false)} onOk={() => void update({ type:'create',recipientId:recipientId!,content,dueAt:new Date(due).getTime() })} okText="保存待确认任务" confirmLoading={busy} okButtonProps={{ disabled:!recipientId || !content.trim() || !due || new Date(due).getTime() <= Date.now() }}>
      <Space orientation="vertical" style={{ width:'100%' }}><Select aria-label="发送接收方" placeholder="选择接收方" style={{ width:'100%' }} showSearch optionFilterProp="label" value={recipientId} onChange={setRecipientId} options={recipients.map(item => ({ value:item.id,label:item.name }))} /><Input.TextArea aria-label="定时发送内容" value={content} maxLength={4000} onChange={event => setContent(event.target.value)} /><Input type="datetime-local" aria-label="定时发送时间" value={due} onChange={event => setDue(event.target.value)} /></Space>
    </Modal>
    <Modal title="执行日志" open={Boolean(logTask)} onCancel={() => setLogId(undefined)} footer={null}>{logTask?.logs.map((log,index) => <p key={index}>{new Date(log.at).toLocaleString('zh-CN')} · {log.detail}</p>)}</Modal>
  </section>
}
