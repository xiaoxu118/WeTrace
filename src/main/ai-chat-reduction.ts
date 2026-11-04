import { createHash } from 'node:crypto'
import { ModelContextLimitError } from './report-model'
import type { AiChatTurn, AiConversationMemory } from '../shared/ai-chat'

// Character budgets are conservative heuristics, not model-specific token counts.
// Provider capacity rejections trigger smaller requests, with room reserved for output.
export const chatPromptBudget = 16000

export async function withChatContextBudget<T>(
  run: (budget: number) => Promise<T>,
  signal?: AbortSignal,
  onShrink?: (budget: number) => void,
): Promise<T> {
  for (let budget = chatPromptBudget; ; budget = Math.floor(budget / 2)) {
    signal?.throwIfAborted()
    try { return await run(budget) } catch (error) {
      if (!(error instanceof ModelContextLimitError)) throw error
      signal?.throwIfAborted()
      if (budget <= 4000) throw new Error('当前模型的上下文容量仍不足，请缩短问题或自定义提示词，或选择容量更大的模型；聊天日期范围未被缩小')
      onShrink?.(Math.floor(budget / 2))
    }
  }
}

export function chatPayloadBudget(prefix: string, budget: number): number {
  const available = budget - prefix.length - 64
  if (available < 512) throw new Error('问题、对话背景或自定义提示词过长，请精简后重试；聊天记录尚未被截取')
  return available
}

/** Recent context is for resolving follow-ups, never a second copy of the evidence. */
export function boundedChatHistory(turns: AiChatTurn[], budget = 4000): string {
  const selected: { role: string; content: string }[] = []
  for (const turn of [...turns].reverse()) {
    const limit = turn.role === 'user' ? 1200 : 500
    const item = { role: turn.role, content: turn.content.length > limit ? turn.content.slice(0, limit) + '…（历史内容已缩略）' : turn.content }
    if (JSON.stringify([item, ...selected]).length > budget) break
    selected.unshift(item)
  }
  return JSON.stringify(selected)
}

/** Strict payload limit, including separators; unlike truncation, every source character survives. */
export function splitChatText(lines: string[], budget: number): string[] {
  if (!Number.isInteger(budget) || budget < 2) throw new Error('聊天分析批次预算无效')
  const batches: string[] = []
  let current = ''
  for (const line of lines) {
    for (let offset = 0; offset < line.length;) {
      const room = budget - current.length - (current ? 1 : 0)
      if (room <= 0 || (current && line.length - offset > room)) { batches.push(current); current = ''; continue }
      const piece = line.slice(offset, offset + room)
      current += (current ? '\n' : '') + piece
      offset += piece.length
    }
  }
  if (current) batches.push(current)
  return batches
}

/** Long messages repeat their attribution on every fragment rather than losing sender/time. */
export function splitChatRecords(records: { time: string; sender: string; text: string }[], budget: number): string[] {
  const lines = records.flatMap(record => {
    const line = JSON.stringify(record)
    if (line.length <= budget) return [line]
    const header = JSON.stringify({ ...record, text: '', fragment: true })
    const length = Math.floor((budget - header.length - 8) / 6)
    if (length < 2) throw new Error('单条消息的发言人或时间信息过长，无法安全分批')
    const fragments: string[] = []
    for (let offset = 0; offset < record.text.length;) {
      let end = Math.min(record.text.length, offset + length)
      const last = record.text.charCodeAt(end - 1)
      if (end < record.text.length && last >= 0xd800 && last <= 0xdbff) end--
      fragments.push(JSON.stringify({ ...record, text: record.text.slice(offset, end), fragment: true }))
      offset = end
    }
    return fragments
  })
  return splitChatText(lines, budget)
}

/** Conservative estimate across mixed Chinese/Latin text; not a model tokenizer. */
export function estimateChatTokens(text: string): number {
  let ascii = 0, other = 0
  for (const character of text) {
    if (character.codePointAt(0)! <= 0x7f) ascii++
    else other += character.codePointAt(0)! > 0xffff ? 3 : 2
  }
  return Math.ceil(ascii / 3) + other
}

/** Compact near capacity, retaining every source batch; output targets are advisory. */
export async function reduceChatNotes(
  notes: string[],
  summarize: (batch: string, targetCharacters: number) => Promise<string>,
  signal?: AbortSignal,
  budget = 18000,
  tokenBudget = Infinity,
  onProgress?: (detail: string) => void,
): Promise<string> {
  signal?.throwIfAborted()
  if (!Number.isFinite(budget) || budget < 2 || !(tokenBudget >= 6)) throw new Error('聊天压缩预算无效')
  const characterTarget = Math.floor(budget * 0.8)
  const tokenTarget = Number.isFinite(tokenBudget) ? Math.floor(tokenBudget * 0.8) : Infinity
  let batchBudget = Math.min(budget, Number.isFinite(tokenBudget) ? Math.max(2, Math.floor(tokenBudget / 3)) : budget)
  let evidence = notes.filter(note => note.trim()).join('\n')
  let stalled = 0, round = 0
  while (evidence.length > characterTarget || estimateChatTokens(evidence) > tokenTarget) {
    signal?.throwIfAborted()
    const batches = splitChatText([evidence], batchBudget)
    const reduced: string[] = []
    round++
    onProgress?.(`上下文接近容量阈值，正在压缩第 ${round} 轮 · 约 ${estimateChatTokens(evidence)} token…`)
    for (const [index, batch] of batches.entries()) {
      signal?.throwIfAborted()
      const target = Math.max(1, Math.min(Math.floor(batch.length / 3), Math.floor(characterTarget / batches.length), Number.isFinite(tokenTarget) ? Math.floor(tokenTarget / (3 * batches.length)) : characterTarget))
      const summary = await summarize(batch, target)
      signal?.throwIfAborted()
      if (!summary.trim()) throw new Error('模型返回空的压缩结果，已停止以避免丢失人物证据，请重试')
      // Longer-than-requested summaries remain valid evidence and can be compacted again.
      reduced.push(summary.trim())
      onProgress?.(`正在压缩上下文 · 第 ${round} 轮 ${index + 1}/${batches.length} 批…`)
    }
    const next = reduced.join('\n')
    const currentLoad = Math.max(evidence.length / characterTarget, estimateChatTokens(evidence) / tokenTarget)
    const nextLoad = Math.max(next.length / characterTarget, estimateChatTokens(next) / tokenTarget)
    if (nextLoad < currentLoad) {
      evidence = next
      stalled = 0
    } else {
      // Retry the original evidence in smaller batches, never replace it with expanding output.
      if (++stalled >= 3) throw new Error(`模型连续3次未能压缩上下文（当前${evidence.length}字符，约${estimateChatTokens(evidence)} token）；已停止以避免无限重试或丢失证据，可重试或更换模型`)
      batchBudget = Math.max(Math.min(128, batchBudget), Math.floor(batchBudget / 2))
      onProgress?.('本轮压缩未缩短内容，正在缩小批次重试，原始证据仍保留…')
    }
  }
  return evidence
}

/** Only verified target quotes may trigger a wider source-context review. */
export function emotionalContextWindows(
  messages: { sender: string; text: string }[], target: string, anchors: string[], radius = 40,
): number[][] {
  const centers = [...new Set(anchors.filter(anchor => anchor.length >= 4 && anchor.length <= 300)
    .flatMap(anchor => messages.flatMap((message, index) => message.sender === target && message.text.includes(anchor) ? [index] : [])))]
    .sort((a, b) => a - b)
  const windows: number[][] = []
  for (const center of centers) {
    const start = Math.max(0, center - radius), end = Math.min(messages.length - 1, center + radius)
    const last = windows.at(-1)
    if (last && start <= last[last.length - 1] + 1) {
      for (let i = last[last.length - 1] + 1; i <= end; i++) last.push(i)
    } else windows.push(Array.from({ length: end - start + 1 }, (_, index) => start + index))
  }
  return windows
}

/** Persistent per-chat memory is accepted only for the exact transcript prefix and source scope. */
export async function prepareConversationMemory(
  turns: AiChatTurn[], scope: string, saved: AiConversationMemory | undefined,
  summarize: (batch: string, targetCharacters: number) => Promise<string>,
  budget: number, signal?: AbortSignal, onProgress?: (detail: string) => void,
): Promise<{ history: string; memory: AiConversationMemory }> {
  signal?.throwIfAborted()
  const data = turns.map(({ role, content, createdAt, queryState }) => ({ role, content, createdAt, queryState }))
  const hash = (count: number) => createHash('sha256').update(JSON.stringify(data.slice(0, count))).digest('hex')
  const valid = saved?.version === 1 && saved.scope === scope && Number.isInteger(saved.coveredTurns)
    && saved.coveredTurns >= 0 && saved.coveredTurns <= turns.length && typeof saved.summary === 'string'
    && saved.summary.length <= 16000 && (saved.coveredTurns === 0 ? saved.summary === '' : Boolean(saved.summary.trim()))
    && saved.prefixHash === hash(saved.coveredTurns)
  let covered = valid ? saved.coveredTurns : 0
  let summary = valid ? saved.summary : ''
  const serialize = () => JSON.stringify({ memory: summary, recent: data.slice(covered) })
  let history = serialize()
  if (history.length > budget * 0.8 || estimateChatTokens(history) > budget * 0.8) {
    onProgress?.('对话记忆接近容量阈值，正在整理早期问答并保留人物、纠正与未完成任务…')
    // Keep the newest complete turns verbatim when they fit; every older turn enters compaction.
    let start = data.length
    while (start > covered && data.length - start < 4) {
      const recent = JSON.stringify(data.slice(start - 1))
      if (recent.length > budget / 3 || estimateChatTokens(recent) > budget / 3) break
      start--
    }
    const recent = JSON.stringify(data.slice(start))
    const available = Math.max(64, Math.floor(budget * 0.75) - Math.max(recent.length, estimateChatTokens(recent)) - 64)
    const sources = [summary ? `已有对话记忆（数据）：${summary}` : '', ...data.slice(covered, start).map(turn => JSON.stringify(turn))].filter(Boolean)
    summary = await reduceChatNotes(sources, summarize, signal, available, available, onProgress)
    covered = start
    history = serialize()
    // JSON escaping can increase the payload; compact again without discarding the recent turns.
    while (history.length > budget || estimateChatTokens(history) > budget) {
      summary = await reduceChatNotes([summary], summarize, signal, Math.max(32, Math.floor(summary.length * 0.6)), Math.max(32, Math.floor(estimateChatTokens(summary) * 0.6)), onProgress)
      history = serialize()
    }
  }
  signal?.throwIfAborted()
  return { history, memory: { version: 1, scope, summary, coveredTurns: covered, prefixHash: hash(covered) } }
}
