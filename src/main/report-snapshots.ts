import { reportSelectionDate, selectReportMessages, validateReportSelection } from '../shared/report-selection.ts'
import { randomUUID } from 'node:crypto'
import { allReportContentTypes, filterReportMessages, reportDateTimestamp } from '../shared/report-messages.ts'
import type { GenerateReportInput, ReportConversationQuery, ReportConversationSnapshot, ReportMessagesQuery, ReportMessagesResult } from '../shared/types'

// Keep only the current selection per window; generation holds its own immutable reference.
export class ReportSnapshotStore {
  private snapshots = new Map<number, { id: string; root?: string; data: ReportMessagesResult }>()
  private selections = new Map<number, number>()
  private sequence = 0

  private readonly read: (query: ReportMessagesQuery) => Promise<ReportMessagesResult>
  constructor(read: (query: ReportMessagesQuery) => Promise<ReportMessagesResult>) { this.read = read }

  async load(owner: number, query: ReportConversationQuery): Promise<ReportConversationSnapshot> {
    if (!query || typeof query.conversationId !== 'string' || !query.conversationId.trim()) throw new Error('请选择会话')
    const selection = ++this.sequence
    this.selections.set(owner, selection)
    this.snapshots.delete(owner)
    if (query.selectedMessages) {
      validateReportSelection(query.selectedMessages)
      const dates = query.selectedMessages.map(item => item.createdAt)
      const data = await this.read({ root: query.root, conversationId: query.conversationId, startDate: reportSelectionDate(Math.min(...dates)), endDate: reportSelectionDate(Math.max(...dates)), contentTypes: [...allReportContentTypes], deferMedia: true, selectedMessages: query.selectedMessages })
      if (this.selections.get(owner) !== selection) throw new Error('会话选择已变化，忽略旧记录')
      const messages = selectReportMessages(data.messages, query.selectedMessages)
      const id = randomUUID()
      // Hold the selected originals in this window's snapshot; configuration changes never reload them.
      this.snapshots.set(owner, { id, root: query.root, data: { ...data, messages, selectionOnly: true, indexRevision: undefined } })
      return { snapshotId: id, conversationId: query.conversationId, messages: messages.map(message => ({ ...message, voice: undefined, image: undefined, reportMedia: undefined, text: '' })) }
    }
    const startDate = query.startDate ?? '1970-01-01', endDate = query.endDate ?? '9999-12-31'
    if (reportDateTimestamp(startDate) >= reportDateTimestamp(endDate, true)) throw new Error('报告开始日期不能晚于结束日期')
    const data = await this.read({ root: query.root, conversationId: query.conversationId, startDate, endDate, contentTypes: [...allReportContentTypes], deferMedia: true, metadataOnly: true })
    if (this.selections.get(owner) !== selection) throw new Error('会话选择已变化，忽略旧记录')
    const id = randomUUID()
    this.snapshots.set(owner, { id, root: query.root, data })
    return { snapshotId: id, conversationId: data.conversationId, messages: data.messages.map(message => ({ id: message.id, createdAt: message.createdAt, count: message.count, messageType: message.messageType, from: message.from, senderId: message.senderId, sender: message.sender, text: '', time: message.time })) }
  }

  get(owner: number, input: GenerateReportInput): ReportMessagesResult {
    const snapshot = this.snapshots.get(owner)
    if (!snapshot || snapshot.id !== input.snapshotId || snapshot.root !== input.root || snapshot.data.conversationId !== input.conversationId) throw new Error('会话记录已失效，请重新选择会话')
    if (!input.contentTypes?.length) throw new Error('请至少选择一种内容类型')
    if (!snapshot.data.selectionOnly && (input.startDate < snapshot.data.startDate || input.endDate > snapshot.data.endDate)) throw new Error('日期范围已变化，请重新读取记录')
    return { ...filterReportMessages(snapshot.data.messages, input), selectionOnly: snapshot.data.selectionOnly }
  }

  async forGeneration(owner: number, input: GenerateReportInput): Promise<ReportMessagesResult> {
    const selected = this.get(owner, input)
    const snapshot = this.snapshots.get(owner)!
    if (!snapshot.data.indexRevision) return selected
    return this.read({ root: input.root, conversationId: input.conversationId, startDate: input.startDate, endDate: input.endDate, contentTypes: input.contentTypes, deferMedia: true, metadataOnly: false, indexRevision: snapshot.data.indexRevision })
  }

  clear(owner: number): void {
    this.snapshots.delete(owner)
    this.selections.delete(owner)
  }
}
