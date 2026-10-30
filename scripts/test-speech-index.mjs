import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { querySpeechIndex, queryConversationIndexSummary } from '../src/main/speech-index.ts'
const directory = mkdtempSync(join(tmpdir(), 'speech-test-'))
const time = new Date('2026-10-29T12:00:00').getTime() / 1000
let version = 'v1', reads = 0
let rows = [
  { id: '1', sender: 'a', createTime: time, type: 1, isSend: false },
  { id: '2', sender: 'b', createTime: time, type: 34, isSend: false },
  { id: '3', sender: 'a', createTime: time, type: 10000, isSend: false },
  { id: '4', sender: '', createTime: time - 86400, type: 1, isSend: true },
]
const query = { conversationId: 'room@chatroom', startDate: '', endDate: '' }
const run = (q = query, account = 'account') => querySpeechIndex(directory, account, q, () => version, () => { reads++; return rows }, 'me')
try {
  assert.equal(run().total, 3)
  assert.equal(reads, 1)
  const summary = queryConversationIndexSummary(directory, 'account', query.conversationId, () => version, () => { throw new Error('summary should reuse speech index') }, 'me')
  assert.deepEqual(summary, { total: 4, firstAt: (time - 86400) * 1000, lastAt: time * 1000 }, 'record total includes system messages and complete history')
  assert.equal(run({ ...query, startDate: '2026-10-29', endDate: '2026-10-29' }).total, 2)
  assert.equal(reads, 1, 'date changes reuse persisted index')
  assert.equal(run({ ...query, startDate: '2026-10-30' }).total, 0)
  run(query, 'other-account')
  assert.equal(reads, 2, 'accounts are isolated')
  rows = rows.slice(0, 1); version = 'v2'
  assert.equal(run().total, 1, 'source updates rebuild, including deletions')
  assert.throws(() => run({ ...query, startDate: '2026-10-30', endDate: '2026-10-29' }))
  version = 'v3'
  assert.throws(() => querySpeechIndex(directory, 'account', query, () => version, () => { throw new Error('read failed') }, 'me'))
  version = 'v2'
  assert.equal(run().total, 1, 'failed rebuild preserves previous index')
  const refreshed = queryConversationIndexSummary(directory, 'account', query.conversationId, () => version, () => { throw new Error('unexpected read') }, 'me')
  assert.equal(refreshed.total, 1, 'summary shares source invalidation')
  const empty = queryConversationIndexSummary(directory, 'account', 'empty@chatroom', () => version, () => [], 'me')
  assert.deepEqual(empty, { total: 0, firstAt: null, lastAt: null })
  console.log('Speech index: persistence, date bounds, account isolation, invalidation and rollback passed')
} finally { rmSync(directory, { recursive: true, force: true }) }
