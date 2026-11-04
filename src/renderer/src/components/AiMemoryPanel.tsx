import { Alert, Button, Empty, Input, List, Modal, Popconfirm, Space, Switch } from 'antd'
import { useEffect, useState } from 'react'
import type { AiLongTermMemory, AiMemoryAction } from '../../../shared/ai-long-term-memory'

export function AiMemoryPanel({ root, onClose }: { root: string; onClose: () => void }) {
  const [memory, setMemory] = useState<AiLongTermMemory>()
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function update(action: AiMemoryAction) {
    setBusy(true)
    try {
      const response = await window.wetrace.aiMemory(root, action)
      if (!response.ok) throw new Error(response.error)
      setMemory(response.memory); setError('')
      if (action.type === 'add') setContent('')
    } catch (error) { setError(error instanceof Error ? error.message : '记忆操作失败') }
    finally { setBusy(false) }
  }
  useEffect(() => { void update({ type: 'load' }) }, [root])
  return <Modal title="长期记忆" open onCancel={onClose} footer={null}>
    {error && <Alert type="error" title={error} />}
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Switch aria-label="使用长期记忆" checkedChildren="已开启" unCheckedChildren="已关闭" checked={memory?.enabled ?? false} disabled={!memory || busy} onChange={enabled => void update({ type: 'enable', enabled })} />
      <Input.TextArea aria-label="记忆内容" placeholder="保存你的回答偏好或称呼约定" value={content} maxLength={500} showCount onChange={event => setContent(event.target.value)} />
      <Button disabled={!memory || busy || !content.trim()} onClick={() => void update({ type: 'add', content })}>保存记忆</Button>
      <List dataSource={memory?.entries ?? []} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无记忆" /> }} renderItem={entry => <List.Item actions={[<Button key="delete" type="text" danger disabled={busy} onClick={() => void update({ type: 'delete', id: entry.id })}>删除</Button>]}>{entry.content}</List.Item>} />
      <Popconfirm title="清空当前账号的全部长期记忆？" onConfirm={() => update({ type: 'clear' })}><Button danger disabled={busy || !memory?.entries.length}>清空记忆</Button></Popconfirm>
    </Space>
  </Modal>
}
