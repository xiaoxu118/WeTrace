import type { ReportMessageSelection, SyncMessage } from './types'

export function reportSelectionKey(item: ReportMessageSelection): string {
  return JSON.stringify([item.createdAt, item.id, item.entryIndex ?? null])
}
export function reportSelectionDate(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function validateReportSelection(items: ReportMessageSelection[]): void {
  if (!Array.isArray(items) || !items.length || items.length > 5000) throw new Error('请选择 1–5000 条消息')
  for (const item of items) if (!item || typeof item.id !== 'string' || !item.id || !Number.isFinite(item.createdAt) || (item.entryIndex !== undefined && (!Number.isInteger(item.entryIndex) || item.entryIndex < 0))) throw new Error('所选消息标识无效，请重新选择')
}

/** Resolve only original records; clients never supply report text or author identities. */
export function selectReportMessages(messages: SyncMessage[], items: ReportMessageSelection[]): SyncMessage[] {
  validateReportSelection(items)
  const parents = new Map(messages.map(message => [reportSelectionKey(message), message]))
  const selected = new Map<string, SyncMessage>()
  for (const item of items) {
    const message = parents.get(reportSelectionKey({ id: item.id, createdAt: item.createdAt }))
    if (!message) throw new Error('部分所选消息已不存在，请返回聊天记录重新选择')
    if (!message.forwarded) {
      if (item.entryIndex !== undefined) throw new Error('转发记录内容已变化，请重新选择')
      selected.set(reportSelectionKey(message), { ...message, count: undefined, quote: undefined })
      continue
    }
    const indices = item.entryIndex === undefined ? message.forwarded.entries.map((_, index) => index) : [item.entryIndex]
    if (!indices.length) throw new Error('所选转发记录没有可解析的内部消息，请先在微信中下载完整内容')
    for (const index of indices) {
      const entry = message.forwarded.entries[index]
      if (!entry) throw new Error('转发记录内容已变化，请重新选择')
      // Time-only labels have no date; retain the parent date instead of inventing one.
      const parsed = entry.time && /^\d{4}[-/年]/.test(entry.time) ? new Date(entry.time).getTime() : NaN
      const createdAt = Number.isFinite(parsed) ? parsed : message.createdAt
      const type = entry.messageType ?? 1
      const id = `forward:${message.createdAt}:${message.id}:${index}`
      selected.set(id, { id, createdAt, from: 'them', sender: entry.sender, messageType: type,
        text: entry.text, time: entry.time || message.time,
        ...(type === 3 ? { image: { unavailable: '转发记录中的图片未提供可读取的原始素材' } } : {}),
        ...(type === 34 ? { voice: { unavailable: '转发记录中的语音未提供可读取的原始素材' } } : {}),
      })
    }
  }
  return [...selected.values()].sort((a, b) => a.createdAt - b.createdAt)
}
