import { ActionButton } from './ui/ActionButton'
import { useMemo, useRef, type ReactNode } from 'react'
import type { ReportMessageSelection, SyncConversation, SyncMessage } from '../../../shared/types'
import { reportSelectionKey } from '../../../shared/report-selection'
import { SafeText } from './SafeText'

export function ReportMessagePicker({ conversation, selected, onChange, renderContent, accountName }: {
  conversation: SyncConversation; selected: ReportMessageSelection[]; onChange: (items: ReportMessageSelection[]) => void;
  renderContent: (message: SyncMessage) => ReactNode; accountName: string;
}) {
  const anchor = useRef<string | undefined>(undefined)
  const items = useMemo(() => conversation.messages.flatMap(message => message.forwarded
    ? message.forwarded.entries.map((_, entryIndex) => ({ id: message.id, createdAt: message.createdAt, entryIndex }))
    : [{ id: message.id, createdAt: message.createdAt } as ReportMessageSelection]), [conversation.messages])
  const chosen = new Set(selected.map(reportSelectionKey))
  const toggle = (refs: ReportMessageSelection[], shift = false) => {
    if (!refs.length) return
    const key = reportSelectionKey(refs[0])
    const add = !refs.every(item => chosen.has(reportSelectionKey(item)))
    let range = refs
    if (shift && anchor.current) {
      const start = items.findIndex(item => reportSelectionKey(item) === anchor.current)
      const end = items.findIndex(item => reportSelectionKey(item) === key)
      if (start >= 0 && end >= 0) range = items.slice(Math.min(start, end), Math.max(start, end) + 1)
    }
    const next = new Map(selected.map(item => [reportSelectionKey(item), item]))
    for (const item of range) { if (add) next.set(reportSelectionKey(item), item); else next.delete(reportSelectionKey(item)) }
    anchor.current = key
    onChange([...next.values()])
  }
  return <div className="report-message-picker" aria-label="选择要总结的消息">
    <p className="report-picker-hint">勾选消息，按住 Shift 可连续多选。合并转发记录可展开选择内部消息；不会自动添加上下文。</p>
    <div className="report-picker-actions"><ActionButton type="button" className="btn sm" onClick={() => onChange(items)}>全选已展示消息</ActionButton><ActionButton type="button" className="btn sm" onClick={() => onChange([])}>清空选择</ActionButton></div>
    {conversation.messages.map((message, index) => {
      const refs: ReportMessageSelection[] = message.forwarded ? message.forwarded.entries.map((_, entryIndex) => ({ id: message.id, createdAt: message.createdAt, entryIndex })) : [{ id: message.id, createdAt: message.createdAt }]
      const count = refs.filter(item => chosen.has(reportSelectionKey(item))).length
      const name = message.sender || (message.from === 'me' ? accountName : conversation.name)
      return <div className={`report-pick-row${count ? ' selected' : ''}`} key={reportSelectionKey(message)}>
        <input type="checkbox" aria-label={`选择第 ${index + 1} 条消息`} checked={!!refs.length && count === refs.length} ref={input => { if (input) input.indeterminate = count > 0 && count < refs.length }} disabled={!refs.length} onChange={event => toggle(refs, (event.nativeEvent as MouseEvent).shiftKey)} />
        <div className="report-pick-content"><div className="report-pick-meta"><b><SafeText>{name}</SafeText></b><span>{new Date(message.createdAt).toLocaleString('zh-CN')}</span></div>
          {message.forwarded ? <details className="report-pick-forwarded"><summary><SafeText>{message.forwarded.title}</SafeText> · 已选 {count}/{refs.length} 条</summary>
            {message.forwarded.entries.map((entry, entryIndex) => <label className="report-pick-entry" key={entryIndex}>
              <input type="checkbox" aria-label={`选择第 ${index + 1} 条消息中的第 ${entryIndex + 1} 条转发消息`} checked={chosen.has(reportSelectionKey(refs[entryIndex]))} onChange={event => toggle([refs[entryIndex]], (event.nativeEvent as MouseEvent).shiftKey)} />
              <span><b><SafeText>{entry.sender}</SafeText></b><small>{entry.time}</small><span className="report-pick-text"><SafeText>{entry.text}</SafeText></span></span>
            </label>)}
            {message.forwarded.unavailable && <p>{message.forwarded.unavailable}</p>}
          </details> : <div className="report-pick-text">{renderContent(message)}</div>}
        </div>
      </div>
    })}
  </div>
}
