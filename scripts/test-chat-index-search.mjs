import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatIndex } from '../src/main/chat-index.ts'
const directory = mkdtempSync(join(tmpdir(), 'chat-index-search-'))
const stores = [{ id: 'one', room: 'group@chatroom', tableName: 'Msg_a', dbPath: 'fixture' }, { id: 'two', room: 'friend', tableName: 'Msg_b', dbPath: 'fixture' }]
const make = (id, content, type = 1) => ({ id: String(id), content, type, sender: 'member', isSend: false, createTime: 1793232000 + id })
let data = { one: Array.from({ length: 2200 }, (_, i) => make(i + 1, `普通记录 ${i + 1}`)), two: [make(1, '机密测试 NEEDLE')] }
let pages = 0, fail = false
const source = {
  stores: () => stores,
  watermark: (store, through) => {
    const rows = data[store.id].filter(row => through === undefined || Number(row.id) <= through)
    return { count: rows.length, maxId: Math.max(0, ...rows.map(row => Number(row.id))), types: rows.reduce((sum, row) => sum + row.type, 0), times: rows.reduce((sum, row) => sum + row.createTime, 0), lengths: rows.reduce((sum, row) => sum + row.content.length, 0) }
  },
  page: (store, after, through, limit) => { pages++; if (fail) throw new Error('source failure'); return data[store.id].filter(row => Number(row.id) > after && Number(row.id) <= through).slice(0, limit) },
}
let index = new ChatIndex(directory, 'account', 'secret', 'self')
try {
  assert.equal((await index.start(source)).state, 'ready')
  assert.equal(index.status().messages, 2201)
  assert.equal(index.messages('group@chatroom', 0, undefined, 60).length, 60)
  assert.equal(index.messages('group@chatroom', 0, undefined, 180).length, 180)
  assert.equal(index.messages('group@chatroom', 0, undefined, 2300).length, 2200)
  assert.equal(index.search('机密测试')[0].room, 'friend')
  assert.equal(index.search('needle').length, 1)
  assert.equal(index.search('机').length, 1)
  const initialPages = pages
  await index.start(source)
  assert.equal(pages, initialPages)
  index.close(); index = new ChatIndex(directory, 'account', 'secret', 'self')
  assert.equal(index.search('NEEDLE').length, 1)
  data.one.push(make(2201, '新增机密测试'))
  await index.start(source)
  assert.equal(pages, initialPages + 1)
  data.two = [make(1, '撤回', 10000)]
  await index.start(source)
  assert.equal(index.search('NEEDLE').length, 0)
  data.one.push(make(2202, '失败后继续'))
  fail = true
  assert.equal((await index.start(source)).state, 'error')
  assert.equal(index.search('失败后继续').length, 0)
  fail = false
  await index.start(source)
  assert.equal(index.search('失败后继续').length, 1)
  const building = index.start(source, true); index.pause()
  assert.equal((await building).state, 'paused')
  assert.ok(index.hasConversation('group@chatroom'))
  await index.start(source)
  index.close()
  for (const file of readdirSync(directory)) for (const text of ['机密测试', 'NEEDLE', '失败后继续']) assert.equal(readFileSync(join(directory, file)).includes(Buffer.from(text)), false)
  console.log('Encrypted index search passed: pagination, one-character/CJK/case-insensitive search, source updates, failed imports, pause/resume and plaintext checks')
} finally { try { index.close() } catch {} rmSync(directory, { recursive: true, force: true }) }
