import assert from 'node:assert/strict'
import { analyzePatterns, localDay } from '../src/shared/chat-patterns.ts'
const base = new Date(2025, 0, 1, 12)
function message(day, count = 2, hour = 12, senderId = 'alice') {
  const date = new Date(base); date.setDate(date.getDate() + day); date.setHours(hour)
  return { id: `${day}:${hour}:${senderId}`, createdAt: date.getTime(), count, messageType: 1, from: 'them', senderId, sender: senderId, text: 'test', time: '' }
}
const daily = Array.from({ length: 90 }, (_, day) => message(day))
const start = localDay(base.getTime()), end = localDay(message(89).createdAt)
assert.equal(analyzePatterns([], start, end).total, 0)
assert.equal(analyzePatterns(daily, start, end).findings.filter(f => f.kind !== 'routine').length, 0)
const spike = [...daily, message(85, 70, 14)]
assert.ok(analyzePatterns(spike, start, end).findings.some(f => f.kind === 'spike'))
assert.ok(!analyzePatterns(spike, start, end, 'id:bob').total)
const weekend = daily.map(m => ({ ...m, count: [0, 6].includes(new Date(m.createdAt).getDay()) ? 60 : 2 }))
assert.ok(!analyzePatterns(weekend, start, end).findings.some(f => f.kind === 'spike'))
assert.ok(analyzePatterns([message(0), message(30, 4)], start, end).findings.some(f => f.kind === 'return'))
assert.ok(!analyzePatterns([message(30, 4)], start, end).findings.some(f => f.kind === 'return'))
assert.ok(analyzePatterns([...daily, message(85, 7, 2)], start, end).findings.some(f => f.kind === 'night'))
assert.ok(!analyzePatterns(daily.map(m => ({ ...m, createdAt: new Date(m.createdAt).setHours(2) })), start, end).findings.some(f => f.kind === 'night'))
assert.ok(analyzePatterns(daily.map((m, i) => ({ ...m, count: i >= 56 ? 20 : 2 })), start, end).findings.some(f => f.kind === 'trend'))
assert.equal(analyzePatterns([{ ...message(0), messageType: 10000 }], start, end).total, 0)
assert.equal(analyzePatterns(daily, end, start).total, 0)
console.log('聊天脉络：稳定节律、周末基线、突增、成员筛选、沉默回归、凌晨异常、持续变化与系统消息过滤通过。')

// Switching scope must recompute findings using that member's own history.
const aliceSpikeDay = localDay(message(85).createdAt)
const bobMessages = daily.map(m => ({ ...m, id: `bob:${m.id}`, senderId: 'bob', sender: 'bob' }))
const combined = [...spike, ...bobMessages]
const aliceResult = analyzePatterns(combined, start, end, 'id:alice')
const bobResult = analyzePatterns(combined, start, end, 'id:bob')
assert.ok(aliceResult.findings.some(f => f.kind === 'spike' && f.date === aliceSpikeDay))
assert.ok(!bobResult.findings.some(f => f.kind === 'spike'))
assert.equal(bobResult.total, 180)
assert.deepEqual(analyzePatterns(combined, start, end, 'id:alice'), aliceResult)
console.log('观察对象切换：成员独立基线、事件更新和切换还原通过。')

// The recent half peaks at noon; the older half dominates the 180-day evening peak.
const history180 = Array.from({ length: 180 }, (_, day) => message(day, day < 90 ? 10 : 2, day < 90 ? 20 : 12))
const rangeEnd = localDay(message(179).createdAt)
const recentStart = localDay(message(90).createdAt)
const recentRoutine = analyzePatterns(history180, recentStart, rangeEnd).findings.find(f => f.kind === 'routine')
const fullRoutine = analyzePatterns(history180, start, rangeEnd).findings.find(f => f.kind === 'routine')
assert.match(recentRoutine.detail, /下午 12:00–18:00/)
assert.match(fullRoutine.detail, /晚上 18:00–24:00/)
assert.match(recentRoutine.detail, /180 条消息、90 个活跃日/)
assert.match(fullRoutine.detail, /1080 条消息、180 个活跃日/)
assert.notEqual(recentRoutine.detail, fullRoutine.detail)
assert.deepEqual(analyzePatterns(history180, recentStart, rangeEnd).findings.find(f => f.kind === 'routine'), recentRoutine)
console.log('日常节律范围回归通过：90天与180天高峰、总量、活跃日及切回一致性')

const periodMessages = Array.from({ length: 14 }, (_, day) => [message(day, 1, 6), message(day, 2, 12), message(day, 3, 18), message(day, 4, 0)]).flat()
const periodRoutine = analyzePatterns(periodMessages, start, localDay(message(13).createdAt)).findings.find(f => f.kind === 'routine')
assert.match(periodRoutine.detail, /上午 06:00–12:00：14 条（10.0%）/)
assert.match(periodRoutine.detail, /下午 12:00–18:00：28 条（20.0%）/)
assert.match(periodRoutine.detail, /晚上 18:00–24:00：42 条（30.0%）/)
assert.match(periodRoutine.detail, /凌晨 00:00–06:00：56 条（40.0%）/)
console.log('上午、下午、晚上、凌晨分段及边界回归通过')
