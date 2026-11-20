import type { ChatExportQuery } from '../shared/chat-export'

export interface ExportRecord {
  id: number
  time: string
  sender: string
  type: number
  text: string
  quote?: { sender: string; text: string; replyTo?: number }
}

export function serializeChatExport(records: ExportRecord[], format: ChatExportQuery['format']): string {
  if (format === 'json') return JSON.stringify(records, null, 2) + '\n'

  const cell = (value: string | number = '') => {
    const safe = typeof value === 'string' && /^(?:\s*[=+@-]|[\t\r\n])/.test(value) ? "'" + value : String(value)
    return '"' + safe.replaceAll('"', '""') + '"'
  }
  const lines = ['消息编号,时间,发送者,消息类型,内容,引用消息编号,引用发送者,引用内容']
  for (const record of records) {
    lines.push([record.id, record.time, record.sender, record.type, record.text,
      record.quote?.replyTo, record.quote?.sender, record.quote?.text].map(cell).join(','))
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}
