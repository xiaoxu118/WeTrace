import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatIndex } from '../src/main/chat-index.ts'
const directory = mkdtempSync(join(tmpdir(), 'wetrace-all-index-'))
let index
try {
  let version = 'v1', pages = []
  const stores = [{ id: 'store-a', room: 'room-a', tableName: 'Msg_a', dbPath: '/test/a' }, { id: 'store-b', room: 'room-b', tableName: 'Msg_b', dbPath: '/test/b' }]
  const row = (id, sender = 'alice', isSend = false) => ({ id: String(id), createTime: 1700000000 + id, type: 1, content: 'PRIVATE_MESSAGE_CONTENT', isSend, sender })
  const messages = new Map([['store-a', [row(1), row(2, 'me', true)]], ['store-b', [row(1, 'bob')]]])
  const source = {
    stores: () => stores,
    fingerprint: () => version,
    watermark: (store, through) => {
      const rows = messages.get(store.id).filter(row => through === undefined || Number(row.id) <= through)
      return { count: rows.length, maxId: Math.max(0, ...rows.map(row => Number(row.id))), types: rows.reduce((sum, row) => sum + row.type, 0), times: rows.reduce((sum, row) => sum + row.createTime, 0), lengths: rows.reduce((sum, row) => sum + row.content.length, 0) }
    },
    page: (store, after, through, limit) => { pages.push({ store: store.id, after }); return messages.get(store.id).filter(row => Number(row.id) > after && Number(row.id) <= through).slice(0, limit) },
  }
  index = new ChatIndex(directory, 'account', 'secret', 'me')
  assert.equal((await index.start(source)).state, 'ready')
  let decrypted = 0
  const unseal = index.unseal.bind(index)
  index.unseal = row => { decrypted++; return unseal(row) }
  assert.equal(index.reportMetadata('room-a').length, 2)
  const overview = index.reportSelection('room-a')
  assert.equal(overview.rows.reduce((sum, row) => sum + row.count, 0), 2)
  assert.equal(overview.revision, index.revision('room-a'))
  assert.equal(decrypted, 0, '选择会话只读取覆盖索引，不解密任何正文')
  assert.equal(index.reportMessages('room-a', 1700000002000, 1700000003000, ['message']).length, 1)
  assert.equal(decrypted, 1, '生成时仅解密所选时段的正文')
  assert.equal(index.reportMessages('room-a', 0, 253402300800000, ['voice']).length, 0)
  assert.throws(() => index.reportContent('room-a', 0, 253402300800000, ['message'], 'old-revision'), /索引已更新/)
  assert.equal(decrypted, 1, '未勾选的内容不解密')
  const selectedDecrypted = decrypted
  assert.deepEqual(index.selectedReportMessages('room-a', [{ id: '1', createdAt: 1700000001000 }, { id: '1', createdAt: 1700000001000 }]).map(row => row.id), ['1'])
  assert.equal(decrypted - selectedDecrypted, 1, '精确选择只解密一条原文，重复引用不重复读取')
  assert.equal(index.selectedReportMessages('room-b', [{ id: '2', createdAt: 1700000002000 }]).length, 0, '精确选择限制在指定会话')
  assert.equal(index.status().messages, 3)
  assert.equal(index.status().conversations, 2)
  assert.equal(index.isFresh('v1'), true)
  assert.equal(index.isFresh('new'), false)
  assert.equal(index.speech('room-a', 0, Infinity).total, 2)
  assert.deepEqual(index.messages('room-a').map(row => row.sender), ['alice', 'me'])
  assert.equal(pages.length, 2)
  await index.start(source)
  assert.equal(pages.length, 2, '未变化的历史不会重复分页读取')
  index.close(); index = new ChatIndex(directory, 'account', 'secret', 'me')
  assert.equal(index.status().messages, 3, '重启后保存所有会话索引')
  assert.equal(index.isFresh('v1'), true)
  messages.get('store-a').push(row(3)); version = 'v2'; pages = []
  await index.start(source)
  assert.deepEqual(pages, [{ store: 'store-a', after: 2 }], '追加消息只读取旧水位之后的新记录')
  assert.equal(index.status().messages, 4)
  messages.get('store-a').shift(); version = 'v3'; pages = []
  await index.start(source)
  assert.equal(index.summary('room-a').total, 2, '删除会使对应消息表重建')
  assert.equal(pages[0].after, 0)
  const changing = { ...source, page: (...args) => { version = 'changed-during-build'; return source.page(...args) } }
  messages.get('store-a').push(row(4)); version = 'v4'
  await index.start(changing)
  assert.equal(index.isFresh('changed-during-build'), false, '跨表构建时变化的源不能作为最新索引')
  await index.start(source)
  assert.equal(index.isFresh(version), true)
  index.pause()
  assert.equal(index.status().state, 'paused')
  await index.start(source)
  assert.equal(index.status().state, 'ready')
  index.close(); index = undefined
  for (const file of readdirSync(directory)) assert.equal(readFileSync(join(directory, file)).includes(Buffer.from('PRIVATE_MESSAGE_CONTENT')), false)
  console.log('全量聊天索引测试通过：跨会话持久化、增量追加、删除重建、成员统计、重启复用、暂停继续、加密与源变化校验。')
} finally { index?.close(); rmSync(directory, { recursive: true, force: true }) }
