import { Alert, Button, Modal, Radio, Select } from 'antd'
import { useEffect, useState } from 'react'
import { profilePersonChoices } from './ProfilePersonSelect'
import type { ChatExportScope } from '../../../shared/chat-export'
import type { GroupMember, SyncConversation } from '../../../shared/types'

export function ChatExport({ root, conversation }: { root: string; conversation: SyncConversation }) {
  const group = conversation.type === 'group'
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<'csv' | 'json'>('csv')
  const [selection, setSelection] = useState('all')
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [memberError, setMemberError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [count, setCount] = useState<number>()

  useEffect(() => {
    if (!open || !group) return
    let active = true
    setLoadingMembers(true)
    setMemberError('')
    void window.wetrace.listGroupMembers({ root, conversationId: conversation.id }).then(result => {
      if (!active) return
      if (result.ok) setMembers(result.members)
      else setMemberError(result.error)
    }).catch(() => {
      if (active) setMemberError('读取群成员失败')
    }).finally(() => {
      if (active) setLoadingMembers(false)
    })
    return () => { active = false }
  }, [open, group, root, conversation.id])

  async function save() {
    if (busy) return
    const scope: ChatExportScope = selection === 'me' || selection === 'peer' || selection === 'all'
      ? { kind: selection } : { kind: 'member', id: selection.slice('member:'.length) }
    setBusy(true)
    setError('')
    setCount(undefined)
    try {
      const result = await window.wetrace.exportChat({ root, conversationId: conversation.id, scope, format })
      if (!result.ok) setError(result.error)
      else if (!result.canceled) setCount(result.count)
    } catch {
      setError('导出失败')
    } finally {
      setBusy(false)
    }
  }

  const options = group
    ? [{ value: 'all', label: '全部成员' }, ...profilePersonChoices('群成员', members).map(member => ({
      value: 'member:' + member.value, label: member.label,
    }))]
    : [{ value: 'all', label: '双方' }, { value: 'me', label: '仅我方' }, { value: 'peer', label: '仅对方' }]

  return <>
    <Button className="speech-entry" onClick={() => { setSelection('all'); setCount(undefined); setError(''); setOpen(true) }}>导出记录</Button>
    <Modal title="导出聊天记录" open={open} onCancel={() => setOpen(false)} onOk={() => void save()}
      okText="导出" cancelText="关闭" confirmLoading={busy} closable={!busy}
      maskClosable={!busy} keyboard={!busy} cancelButtonProps={{ disabled: busy }}>
      <div className="chat-export-fields">
        <label htmlFor="chat-export-scope">导出范围</label>
        <div className="chat-export-scope">
          <Select id="chat-export-scope" value={selection} onChange={value => setSelection(value ?? 'all')}
            options={options} allowClear={selection !== 'all'} virtual={false}
            disabled={busy} loading={loadingMembers}
            getPopupContainer={trigger => trigger.parentElement!}
            showSearch={{ filterOption: (input, option) =>
              option?.label.toLocaleLowerCase().includes(input.trim().toLocaleLowerCase()) ?? false }}
            notFoundContent={loadingMembers ? '正在加载成员…' : '没有匹配的选项'} />
        </div>
        <span id="chat-export-format-label">文件格式</span>
        <Radio.Group aria-labelledby="chat-export-format-label" value={format}
          onChange={event => setFormat(event.target.value)} disabled={busy}>
          <Radio value="csv">CSV</Radio>
          <Radio value="json">JSON</Radio>
        </Radio.Group>
      </div>
      {memberError && <Alert type="error" showIcon message={memberError} />}
      {error && <Alert type="error" showIcon message={error} />}
      {count !== undefined && <Alert type="success" showIcon message={`已导出 ${count} 条记录`} />}
    </Modal>
  </>
}
