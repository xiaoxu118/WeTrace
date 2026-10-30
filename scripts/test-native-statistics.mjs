import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { performance } from 'node:perf_hooks'
import { aggregateMessageStores } from '../src/main/native-statistics.ts'
const db = new DatabaseSync(':memory:')
const stores = [{ dbPath: 'test', tableName: 'Msg_test' }, { dbPath: 'test', tableName: 'Msg_archive' }]
const base = new Date('2026-10-29T00:00:00').getTime() / 1000
try {
  db.exec(`CREATE TABLE Name2Id (user_name TEXT); INSERT INTO Name2Id VALUES ('a'), ('b'), ('self');`)
  for (const store of stores) db.exec(`CREATE TABLE ${store.tableName} (local_id INTEGER PRIMARY KEY, real_sender_id INTEGER, create_time INTEGER, local_type INTEGER); CREATE INDEX ${store.tableName}_time ON ${store.tableName}(create_time)`)
  const insert = db.prepare('INSERT INTO Msg_test VALUES (?, ?, ?, ?)')
  db.exec('BEGIN')
  for (let id = 1; id <= 100000; id++) insert.run(id, 1, base - 86400, 1)
  insert.run(100001, 1, base, 1)
  insert.run(100002, 2, base + 10, 34)
  insert.run(100003, 2, base + 20, 10000)
  insert.run(100004, 2, base + 86400, 1)
  db.exec(`INSERT INTO Msg_archive VALUES (1, 1, ${base + 30}, 3)`)
  db.exec('COMMIT')
  const query = (_, sql) => { assert.ok(!/SELECT \*|OFFSET|message_content/i.test(sql), 'no body reads or pagination'); return db.prepare(sql).all() }
  const range = { start: base * 1000, end: (base + 86400) * 1000, selfId: 'self' }
  const start = performance.now()
  const today = aggregateMessageStores(stores, query, range)
  assert.equal(today.total, 3)
  assert.deepEqual(today.members.map(({ id, count }) => ({ id, count })), [{ id: 'a', count: 2 }, { id: 'b', count: 1 }])
  const summary = aggregateMessageStores(stores, query)
  assert.equal(summary.total, 100005, 'summary counts all types across shards')
  assert.equal(summary.firstAt, (base - 86400) * 1000)
  db.exec(`INSERT INTO Msg_test VALUES (100005, 3, ${base + 40}, 1)`)
  assert.equal(aggregateMessageStores(stores, query, range).total, 4, 'new source messages visible without rebuilding')
  db.exec('DELETE FROM Msg_test WHERE local_id = 100001')
  assert.equal(aggregateMessageStores(stores, query, range).total, 3, 'deletions visible without rebuilding')
  console.log(`Native statistics passed: 100,005-row indexed fixture, time boundaries, multiple shards, source insert/delete, no body reads (${(performance.now() - start).toFixed(1)}ms total)`)
} finally { db.close() }
