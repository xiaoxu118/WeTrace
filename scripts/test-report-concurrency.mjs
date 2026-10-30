import assert from 'node:assert/strict'
import { imageConcurrency, processConcurrent } from '../src/shared/report-concurrency.ts'
assert.equal(imageConcurrency(), 3)
for (const value of [0, -1, 17, 1.5, NaN, Infinity]) assert.throws(() => imageConcurrency(value), /整数/)
let active = 0
let peak = 0
const finished = []
await processConcurrent([0, 1, 2, 3, 4, 5], 3, async item => {
  active++
  peak = Math.max(peak, active)
  await new Promise(resolve => setTimeout(resolve, item === 0 ? 15 : 2))
  active--
  finished.push(item)
})
assert.equal(peak, 3)
assert.deepEqual(finished.toSorted(), [0, 1, 2, 3, 4, 5])
let release
const gate = new Promise(resolve => { release = resolve })
const started = []
const saved = []
let rejected = false
const task = processConcurrent([0, 1, 2, 3], 2, async item => {
  started.push(item)
  if (item === 0) throw new Error('model failed')
  await gate
  saved.push(item)
})
const rejection = assert.rejects(task, /model failed/).then(() => { rejected = true })
await new Promise(resolve => setTimeout(resolve, 0))
assert.deepEqual(started, [0, 1], '失败后停止派发新任务')
assert.equal(rejected, false, '先等待在途图片保存缓存，再报告失败')
release()
await rejection
assert.deepEqual(saved, [1])
let calls = 0
await processConcurrent([], 3, async () => { calls++ })
assert.equal(calls, 0)
console.log('图片并发测试通过：线程数校验、并发上限、乱序完成、失败停止派发并等待缓存保存。')
