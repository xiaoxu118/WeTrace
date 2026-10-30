import type { ReportParticipant } from './report-facts'
export interface ReportMessageAuthor { reference: string; key: string }
export interface ReportTopic { title: string; lines: string[] }

const citationPattern = /<!--\s*refs?\s*:[\s\S]*?-->|#\d+(?:\s*[–—~-]\s*#?\d+)?|\[(?:#?\d+|r\d+)(?:\s*(?:[、,，;；]|[–—~-])\s*#?(?:r?\d+))*\]/gi

export function cleanReportText(text: string): string {
  return text.replace(/(?:^|\n)(?:覆盖限制|统计口径|数据覆盖说明)[:：][^\n]*/g, '').replace(/<!--[^]*?-->/g, '').replace(/[（(]\s*(?:#\d+|\[r?\d+\])[^()（）\n]*[）)]/g, part => {
    const cleaned = part.replace(citationPattern, '').replace(/[（()）、,，;；\s–—~-]/g, '')
    return cleaned ? part.replace(citationPattern, '') : ''
  }).replace(/(?:并)?在\s*(?=#\d)/g, '').replace(citationPattern, '').replace(/[（(]\s*[）)]/g, '').replace(/ +([，。；：])/g, '$1').replace(/ {2,}/g, ' ').trim()
}

export function cleanReportSummary(text: string): string {
  const sentences = cleanReportText(text).replace(/[*#>]/g, '').match(/[^。！？!?]+[。！？!?]?/g) || []
  const content = sentences.filter(sentence => !/\d+\s*(?:条消息|条语音|张图片|人参与|位成员)|视频.*(?:统计|分析内容)|覆盖限制|不可用素材|(?:本次|本群|本时段|当日).*(?:消息|语音).*(?:统计|\d)/.test(sentence)).join('').replace(/\s+/g, ' ').trim()
  return [...content].slice(0, 100).join('') + ([...content].length > 100 ? '…' : '')
}

export function splitReportTopics(lines: string[]): ReportTopic[] {
  const topics: ReportTopic[] = []
  for (const line of lines) {
    const heading = /^###\s+(.+)$/.exec(line)
    if (heading) topics.push({ title: heading[1], lines: [] })
    else {
      if (!topics.length) topics.push({ title: '', lines: [] })
      topics[topics.length - 1].lines.push(line)
    }
  }
  return topics.filter(topic => topic.title || topic.lines.some(line => line.trim()))
}

export function topicParticipants(text: string, members: ReportParticipant[], authors: ReportMessageAuthor[]): ReportParticipant[] {
  const references: { start: string; end?: string }[] = []
  for (const block of text.match(citationPattern) || []) {
    const body = block.replace(/<!--\s*refs?\s*:|-->|[#[\]]/gi, '')
    for (const match of body.matchAll(/(r?\d+)(?:\s*[–—~-]\s*(r?\d+))?/g)) references.push({ start: match[1], end: match[2] })
  }
  const counts = new Map<string, number>()
  const seen = new Set<string>()
  for (const author of authors) {
    if (seen.has(author.reference)) continue
    const found = references.some(ref => {
      if (!ref.end) return author.reference === ref.start
      const prefix = ref.start.startsWith('r') ? 'r' : ''
      if (author.reference.startsWith('r') !== !!prefix) return false
      const value = Number(author.reference.replace(/^r/, ''))
      return value >= Number(ref.start.replace(/^r/, '')) && value <= Number(ref.end.replace(/^r/, ''))
    })
    if (found) { seen.add(author.reference); counts.set(author.key, (counts.get(author.key) || 0) + 1) }
  }
  if (counts.size) return members.filter(member => counts.has(member.key)).sort((a, b) => counts.get(b.key)! - counts.get(a.key)! || a.key.localeCompare(b.key))
  // Legacy reports may lack hidden references. Show only known members explicitly mentioned.
  return members.filter(member => member.name !== '我' && member.name.trim().length >= 2 && text.includes(member.name))
}

/** Count distinct supporting messages; merge intervals without expanding message ranges. */
export function topicMessageCount(text: string): number {
  const ranges = new Map<string, [number, number][]>()
  for (const block of text.match(citationPattern) || []) {
    const body = block.replace(/<!--\s*refs?\s*:|-->|[#[\]]/gi, '')
    for (const match of body.matchAll(/(r?\d+)(?:\s*[–—~-]\s*(r?\d+))?/g)) {
      const prefix = match[1].startsWith('r') ? 'r' : ''
      const start = Number(match[1].replace(/^r/, ''))
      const end = match[2] ? Number(match[2].replace(/^r/, '')) : start
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) continue
      const list = ranges.get(prefix) ?? []
      list.push([start, end]); ranges.set(prefix, list)
    }
  }
  let count = 0
  for (const list of ranges.values()) {
    list.sort((a, b) => a[0] - b[0])
    let last = -1
    for (const [start, end] of list) {
      if (end > last) count += end - Math.max(start, last + 1) + 1
      last = Math.max(last, end)
    }
  }
  return count
}
