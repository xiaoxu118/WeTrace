import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ReportDiskIndex } from '../src/main/report-disk-index.ts'

const directory = mkdtempSync(join(tmpdir(), 'report-index-test-'))
try {
  let reads = 0
  let fingerprint = 'v1'
  const text = 'PRIVATE_REPORT_CONTENT_不应明文保存'
  let messages = [{ id: '1', createdAt: 1000, messageType: 1, text, from: 'me', time: '12:00' }, { id: '2', createdAt: 2000, messageType: 3, text: '[图片]', from: 'them', time: '12:01', reportMedia: { content: 'private image XML' } }]
  const read = () => { reads++; return { conversationId: 'chat', startDate: '1970-01-01', endDate: '9999-12-31', contentTypes: ['message', 'image'], counts: { message: messages.filter(m => m.messageType === 1).length, image: messages.filter(m => m.messageType === 3).length, voice: 0, video: 0 }, messages } }
  const run = (index = new ReportDiskIndex(directory), account = 'account', secret = 'secret', entry = 'query') => index.get(account, secret, entry, () => fingerprint, read)
  const original = run()
  assert.equal(reads, 1)
  assert.deepEqual(run(), original)
  assert.equal(reads, 1, '重建实例模拟重启，使用持久化索引而不读取微信记录')
  const file = join(directory, readdirSync(directory)[0])
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.equal(readFileSync(file).includes(Buffer.from(text)), false, '正文加密落盘')
  assert.equal(readFileSync(file).includes(Buffer.from('private image XML')), false)
  const db = new DatabaseSync(file)
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT type FROM messages WHERE entry = ? AND time >= ? AND time < ?').all('query', 0, 9999)
  assert.ok(plan.some(row => String(row.detail).includes('report_entry_time_type')))
  db.prepare('UPDATE messages SET payload = ? WHERE entry = ? AND position = 0').run(Buffer.from('corrupt'), 'query')
  db.close()
  assert.deepEqual(run().messages, messages)
  assert.equal(reads, 2, '损坏的加密条目会重新读取并修复')
  run(); assert.equal(reads, 2)
  messages = messages.slice(0, 1); fingerprint = 'v2'
  assert.equal(run().messages.length, 1)
  assert.equal(reads, 3, '数据变化后更新缓存，也处理删除')
  assert.throws(() => new ReportDiskIndex(directory).get('account', 'secret', 'query', () => 'v3', () => { throw new Error('source failed') }), /source failed/)
  run(); assert.equal(reads, 3, '读取失败不破坏上一个有效索引')
  run(undefined, 'other-account'); run(undefined, 'account', 'other-secret')
  assert.equal(reads, 5, '账号和数据库密钥隔离')
  let changing = 'v4'
  new ReportDiskIndex(directory).get('account', 'secret', 'changing', () => changing, () => { changing = 'v5'; return read() })
  new ReportDiskIndex(directory).get('account', 'secret', 'changing', () => 'v4', read)
  assert.equal(reads, 7, '读取中变化的源不记录为有效缓存')
  const blocked = join(directory, 'blocked')
  writeFileSync(blocked, '')
  const fallback = run(new ReportDiskIndex(blocked))
  assert.equal(fallback.messages.length, 1, '缓存不可写时仍返回本次读取结果')
  console.log('报告磁盘索引测试通过：重启复用、加密落盘、时间/类型索引、变化刷新、删除同步、损坏修复、账号隔离及读取失败回退。')
} finally { rmSync(directory, { recursive: true, force: true }) }
