import type { SyncMessage } from './types'
import { reportMemberKey } from './report-messages.ts'

export interface PatternFinding { id: string; date: string; title: string; detail: string; kind: 'spike' | 'return' | 'night' | 'trend' | 'routine' }
export function localDay(time: number): string {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  return sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : 0
}
export function analyzePatterns(messages: SyncMessage[], start: string, end: string, member = '') {
  const records = messages.filter(m => Number.isFinite(m.createdAt) && m.messageType !== 10000 && m.messageType !== 10002 && (!member || reportMemberKey(m) === member)).sort((a, b) => a.createdAt - b.createdAt)
  const daily = new Map<string, { count: number; night: number }>()
  for (const m of records) {
    const day = localDay(m.createdAt), item = daily.get(day) ?? { count: 0, night: 0 }, n = m.count ?? 1
    item.count += n
    if (new Date(m.createdAt).getHours() < 5) item.night += n
    daily.set(day, item)
  }
  const first = records[0] && localDay(records[0].createdAt), findings: PatternFinding[] = []
  const days: { date: string; count: number; night: number }[] = []
  if (!first || !start || !end || start > end) return { days, findings, total: 0 }
  const cursor = new Date(`${first}T12:00:00`), history: typeof days = []
  let previousActive = -1
  while (localDay(cursor.getTime()) <= end) {
    const date = localDay(cursor.getTime()), day = { date, ...(daily.get(date) ?? { count: 0, night: 0 }) }, index = history.length
    const prior = history.slice(-84), weekday = cursor.getDay()
    const comparable = prior.filter(d => new Date(`${d.date}T12:00:00`).getDay() === weekday)
    const ready = comparable.length >= 4
    const baseline = median(comparable.map(d => d.count))
    const deviation = median(comparable.map(d => Math.abs(d.count - baseline)))
    if (date >= start) {
      days.push(day)
      if (ready && day.count >= 15 && day.count > Math.max(baseline * 3, baseline + 6 * Math.max(deviation, 2))) findings.push({ id: `spike:${date}`, date, kind: 'spike', title: member ? '这一天，突然聊了很多' : '群里异常热闹的一天', detail: `当天 ${day.count} 条消息；此前 ${comparable.length} 个同星期日的发言中位数为 ${baseline} 条。` })
      if (day.count >= 3 && previousActive >= 0 && index - previousActive >= 15) findings.push({ id: `return:${date}`, date, kind: 'return', title: member ? '久违的回归' : '沉寂后的重新热闹', detail: `在本地记录中，连续 ${index - previousActive - 1} 天没有发言后，当天出现了 ${day.count} 条消息。` })
      if (ready && day.night >= 5 && prior.filter(d => d.night > 0).length / prior.length < 0.1) findings.push({ id: `night:${date}`, date, kind: 'night', title: '不寻常的凌晨发言', detail: `当天 00:00–04:59 有 ${day.night} 条消息；此前 ${prior.length} 天仅 ${prior.filter(d => d.night > 0).length} 天有该时段发言。` })
      if (index >= 56 && (index % 14 === 0 || date === end)) {
        const earlier = history.slice(-56, -28).reduce((n, d) => n + d.count, 0), recent = history.slice(-28).reduce((n, d) => n + d.count, 0)
        if (Math.max(earlier, recent) >= 60 && (recent > earlier * 2 || recent < earlier * 0.5)) findings.push({ id: `trend:${date}`, date, kind: 'trend', title: recent > earlier ? '最近四周，更常出现了' : '最近四周，渐渐安静了', detail: `截至前一天，最近 28 天共 ${recent} 条消息，之前 28 天为 ${earlier} 条。` })
      }
    }
    if (day.count) previousActive = index
    history.push(day)
    cursor.setDate(cursor.getDate() + 1)
  }
  const hours = Array.from({ length: 24 }, () => 0)
  for (const m of records) if (localDay(m.createdAt) >= start && localDay(m.createdAt) <= end) hours[new Date(m.createdAt).getHours()] += m.count ?? 1
  const total = days.reduce((n, d) => n + d.count, 0), peak = hours.indexOf(Math.max(...hours))
  if (days.filter(d => d.count).length >= 14) findings.push({ id: 'routine', date: '', kind: 'routine', title: '日常的聊天节律', detail: `这段时间最活跃的是 ${peak}:00–${peak}:59，共 ${hours[peak]} 条，占消息总量的 ${(hours[peak] / total * 100).toFixed(1)}%。` })
  return { days, total, findings: findings.reverse().slice(0, 40) }
}
