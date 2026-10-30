import type { ReportContentType, ReportMessagesFilter, ReportMessagesResult, SyncMessage } from './types'

export const allReportContentTypes: ReportContentType[] = ['message', 'voice', 'image', 'video']

export function reportContentType(messageType: number): ReportContentType {
  if (messageType === 3) return 'image'
  if (messageType === 34) return 'voice'
  if (messageType === 43) return 'video'
  return 'message'
}

export function reportDateTimestamp(value: string, nextDay = false): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error('报告日期格式无效')
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error('报告日期无效')
  if (nextDay) date.setDate(date.getDate() + 1)
  return date.getTime()
}

export function filterReportMessages(messages: SyncMessage[], filter: ReportMessagesFilter): ReportMessagesResult {
  const start = reportDateTimestamp(filter.startDate)
  const end = reportDateTimestamp(filter.endDate, true)
  if (start >= end) throw new Error('报告开始日期不能晚于结束日期')
  if (!Array.isArray(filter.contentTypes) || filter.contentTypes.some(type => !allReportContentTypes.includes(type))) throw new Error('报告内容类型无效')
  const selected = new Set(filter.contentTypes)
  const counts: Record<ReportContentType, number> = { message: 0, voice: 0, image: 0, video: 0 }
  const result: SyncMessage[] = []
  for (const message of messages) {
    if (message.createdAt < start || message.createdAt >= end) continue
    const type = reportContentType(message.messageType)
    counts[type] += message.count ?? 1
    if (selected.has(type)) result.push(message)
  }
  return { conversationId: filter.conversationId, startDate: filter.startDate, endDate: filter.endDate, contentTypes: allReportContentTypes.filter(type => selected.has(type)), messages: result, counts }
}

export function reportMemberKey(message: SyncMessage): string {
  if (message.from === 'me') return 'self'
  if (message.senderId) return `id:${message.senderId}`
  return message.sender ? `name:${message.sender}` : ''
}

/** Reports show display names only; internal account IDs are never used as nicknames. */
export function reportMemberName(message: SyncMessage): string {
  const name = message.sender?.trim()
  return name && !/^wxid[_-]/i.test(name) ? name : message.from === 'me' ? '我' : '未知成员'
}
