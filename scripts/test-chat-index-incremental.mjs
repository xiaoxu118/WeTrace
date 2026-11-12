import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatIndex } from '../src/main/chat-index.ts'
const directory = mkdtempSync(join(tmpdir(), 'index-incremental-'))
let index
const store = { id: 'one', room: 'room', tableName: 'Msg_one', dbPath: 'fixture' }
let rows = Array.from({ length: 2500 }, (_, i) => ({ id: String(i + 1), sender: 'a', isSend: false, type: 1, content: `message ${i + 1}`, createTime: 1700000000 + i }))
let pages = [], interrupt = true
const mark = data => ({ count: data.length, maxId: Math.max(0, ...data.map(row => Number(row.id))), types: data.reduce((n, row) => n + row.type, 0), times: data.reduce((n, row) => n + row.createTime, 0), lengths: data.reduce((n, row) => n + row.content.length, 0) })
const source = {
  stores: () => [store],
  watermark: (_, through) => mark(rows.filter(row => through === undefined || Number(row.id) <= through)),
  page: (_, after, through, limit) => {
    pages.push(after)
    if (interrupt) { interrupt = false; queueMicrotask(() => { assert.equal(index.status().currentMessages, 1000, '大表未完成时仍保存批次进度'); assert.equal(index.status().currentTotal, 2500); index.pause() }) }
    return rows.filter(row => Number(row.id) > after && Number(row.id) <= through).slice(0, limit)
  },
}
try {
  index = new ChatIndex(directory, 'account', 'secret', 'self')
  assert.equal((await index.start(source)).state, 'paused')
  assert.deepEqual(pages, [0])
  assert.equal(index.status().messages, 0, 'incomplete batches are not published')
  index.close(); index = new ChatIndex(directory, 'account', 'secret', 'self')
  pages = []
  assert.equal((await index.start(source)).state, 'ready')
  assert.deepEqual(pages, [1000, 2000], 'restart resumes after saved batch')
  assert.equal(index.status().messages, 2500)
  rows.push({ ...rows.at(-1), id: '2501', content: 'new message' })
  pages = []
  await index.start(source)
  assert.deepEqual(pages, [2500], 'new messages append without historical reads')
  await index.start(source)
  assert.deepEqual(pages, [2500], 'unchanged sources read zero payloads')
  rows.push({ ...rows.at(-1), id: '2502', content: 'queued update' })
  let once = true
  const queuedSource = { ...source, page: (...args) => {
    const result = source.page(...args)
    if (once) { once = false; rows.push({ ...rows.at(-1), id: '2503', content: 'arrived during import' }); queueMicrotask(() => void index.start(source)) }
    return result
  } }
  await index.start(queuedSource)
  for (let i = 0; i < 100 && index.status().messages !== 2503; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(index.status().messages, 2503, 'updates received during import are queued')
  // Wait for the queued worker to finish before closing the database.
  for (let i = 0; i < 100 && index.status().state === 'building'; i++) await new Promise(resolve => setImmediate(resolve))
  const locked = await index.start({ ...source, watermark: () => { throw new Error('database is locked') } })
  assert.equal(locked.state, 'error')
  assert.deepEqual(locked.errors, ['本地索引正被其他任务占用，请重新更新索引'])
  const recovered = await index.start(source)
  assert.equal(recovered.state, 'ready')
  assert.deepEqual(recovered.errors, [])
  console.log('Incremental index passed: durable batch checkpoint, restart resume, append-only import, unchanged skip and queued catch-up')
} finally { index?.close(); rmSync(directory, { recursive: true, force: true }) }
