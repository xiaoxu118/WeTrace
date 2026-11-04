import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { ChatIndex } from '../src/main/chat-index.ts'
import { ReportDiskIndex } from '../src/main/report-disk-index.ts'

const directory = mkdtempSync(join(tmpdir(), 'wetrace-lock-test-'))
async function withTemporaryLock(file, action) {
  const ready = new SharedArrayBuffer(4)
  const worker = new Worker(`
    const { workerData } = require('node:worker_threads')
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(workerData.file)
    db.exec('BEGIN EXCLUSIVE')
    Atomics.store(new Int32Array(workerData.ready), 0, 1)
    Atomics.notify(new Int32Array(workerData.ready), 0)
    setTimeout(() => { db.exec('ROLLBACK'); db.close(); Atomics.store(new Int32Array(workerData.ready), 0, 2) }, 250)
  `, { eval: true, workerData: { file, ready } })
  const finished = new Promise((resolve, reject) => { worker.on('error', reject); worker.on('exit', code => code === 0 ? resolve() : reject(new Error(`worker exit ${code}`))) })
  try {
    assert.equal(Atomics.wait(new Int32Array(ready), 0, 0, 5000), 'ok')
    action(new Int32Array(ready))
    await finished
  } finally { await worker.terminate() }
}
try {
  const identity = createHash('sha256').update(JSON.stringify(['test-account', 'test-secret'])).digest('hex')
  const chatDirectory = join(directory, 'chat')
  // The first open must wait even before WAL/schema initialization.
  const { mkdirSync } = await import('node:fs')
  mkdirSync(chatDirectory)
  await withTemporaryLock(join(chatDirectory, `${identity}.sqlite`), () => {
    const index = new ChatIndex(chatDirectory, 'test-account', 'test-secret', 'self')
    index.close()
  })
  const reader = new ChatIndex(chatDirectory, 'test-account', 'test-secret', 'self')
  try {
    await withTemporaryLock(join(chatDirectory, `${identity}.sqlite`), ready => {
      reader.exclude([])
      assert.equal(Atomics.load(ready, 0), 1, 'empty exclusion initialization must not wait for or acquire a writer lock')
      assert.equal(reader.status().messages, 0, 'WAL reads remain available during writes')
    })
  } finally { reader.close() }
  const reportDirectory = join(directory, 'report')
  const index = new ReportDiskIndex(reportDirectory)
  const data = { conversationId: 'test-room', startDate: '2026-01-01', endDate: '2026-01-02', contentTypes: ['message'], counts: { message: 0, voice: 0, image: 0, video: 0 }, messages: [] }
  index.get('test-account', 'test-secret', 'entry', () => 'v1', () => data)
  const file = join(reportDirectory, readdirSync(reportDirectory).find(name => name.endsWith('.sqlite')))
  await withTemporaryLock(file, () => {
    assert.deepEqual(index.get('test-account', 'test-secret', 'entry', () => 'v2', () => data), data)
  })
  console.log('SQLite temporary-lock recovery passed: initial chat-index open and report-cache write')
} finally { rmSync(directory, { recursive: true, force: true }) }
