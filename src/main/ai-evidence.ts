import type { AiEvidenceQuery, AiEvidencePage } from '../shared/ai-evidence'
import type { ReportMessagesQuery, ReportMessagesResult } from '../shared/types'

/** Filter and paginate before IPC: large source histories never enter the renderer. */
export async function queryAiEvidence(input: AiEvidenceQuery, read: (query: ReportMessagesQuery) => Promise<ReportMessagesResult>): Promise<AiEvidencePage> {
  if (!input || typeof input.root !== 'string' || !input.root.trim() || !input.state || typeof input.state.conversationId !== 'string' || !input.state.conversationId || typeof input.keyword !== 'string' || input.keyword.length > 500 || !Number.isSafeInteger(input.page) || input.page < 1 || input.page > 1000000) throw new Error('原文查询条件无效')
  const { state } = input
  for (const value of [state.startDate, state.endDate]) if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('原文查询日期无效')
  if (state.startDate > state.endDate) throw new Error('原文查询日期无效')
  const source = await read({ root: input.root, conversationId: state.conversationId, startDate: state.startDate, endDate: state.endDate, contentTypes: ['message', 'voice', 'image', 'video'], deferMedia: true })
  const keyword = input.keyword.trim()
  const offset = (input.page - 1) * 50
  let total = 0
  const messages: AiEvidencePage['messages'] = []
  for (const message of source.messages) {
    if (keyword && !message.text.includes(keyword) && !message.sender?.includes(keyword)) continue
    if (total >= offset && messages.length < 50) messages.push(message)
    total++
  }
  return { messages, total }
}
