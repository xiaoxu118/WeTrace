import { splitReportText } from './report-model'

/** Bound each merge request instead of bounding the number of source batches. */
export async function reduceChatNotes(
  notes: string[],
  summarize: (batch: string) => Promise<string>,
  signal?: AbortSignal,
  budget = 18000,
): Promise<string> {
  let batches = splitReportText(notes, budget)
  while (batches.length > 1) {
    const reduced: string[] = []
    for (const batch of batches) {
      signal?.throwIfAborted()
      // Reserve room so each reduction round makes progress even on verbose models.
      const summary = await summarize(batch)
      if (!summary.trim()) throw new Error('记录摘要为空，请重试')
      if (summary.length > Math.floor(budget / 3)) throw new Error('记录摘要过长，请选择更简洁的模型后重试')
      reduced.push(summary)
    }
    batches = splitReportText(reduced, budget)
  }
  return batches[0] ?? ''
}
