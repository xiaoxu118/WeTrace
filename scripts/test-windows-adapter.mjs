// All accounts, messages and keys below are synthetic. Never accesses WeChat.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { createHash } from 'node:crypto'
import koffi from 'koffi'
assert.equal(process.platform, 'win32')
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !path.extname(specifier)) {
      const target = new URL(specifier + '.ts', context.parentURL)
      if (fs.existsSync(target)) return next(target.href, context)
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.ts')) return { format: 'module', source: stripTypeScriptTypes(fs.readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }), shortCircuit: true }
    return next(url, context)
  },
})
const { WindowsWcdbDatabase, createWindowsBindings } = await import('../src/main/windows-wcdb.ts')
const { Wcdb4Client } = await import('../src/main/wcdb4-client.ts')
const library = koffi.load(path.resolve('resources/wcdb/windows/x64/WCDB.dll'))
const object = koffi.struct({ innerValue: 'void*' })
const bind = (name, result, args) => library.func(name, result, args)
const create = bind('WCDBCoreCreateDatabase', object, ['str', 'bool', 'bool'])
const cipher = bind('WCDBDatabaseConfigCipher', 'void', [object, 'void*', 'int', 'int', 'int'])
const handle = bind('WCDBDatabaseGetHandle', object, [object, 'bool'])
const execute = bind('WCDBHandleExecuteSQL', 'bool', [object, 'str'])
const release = bind('WCDBReleaseCPPObject', 'void', ['void*'])
const close = bind('WCDBDatabaseClose', 'void', [object, 'void*', 'void*'])
const purge = bind('WCDBDatabasePurge', 'void', [object])
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wetrace-adapter-'))
const account = path.join(root, '虚构目录', 'wxid_fixture_account')
const dbRoot = path.join(account, 'db_storage')
const key = '41'.repeat(32), room = 'fixture@chatroom'
const table = 'Msg_' + createHash('md5').update(room).digest('hex')
function fixture(relative, statements, encrypted = true) {
  const file = path.join(dbRoot, relative); fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = create(file, false, false), bytes = Buffer.from(key, 'hex')
  if (encrypted) cipher(db, bytes, bytes.length, 4096, 0)
  const h = handle(db, true)
  try { for (const sql of statements) assert.equal(execute(h, sql), true, '样例创建失败') }
  finally { release(h.innerValue); close(db, null, null); purge(db); release(db.innerValue) }
  return file
}
try {
  const session = fixture('session/session.db', ['CREATE TABLE SessionTable(username TEXT, last_timestamp INTEGER, unread_count INTEGER)', `INSERT INTO SessionTable VALUES('${room}', 1700000003, 2)`])
  fixture('contact/contact.db', ['CREATE TABLE contact(username TEXT, nick_name TEXT, remark TEXT, big_head_url TEXT, small_head_url TEXT)', "INSERT INTO contact VALUES('wxid_fixture', '虚构昵称', '虚构备注', 'https://example.invalid/avatar', '')", "INSERT INTO contact VALUES('wxid_other', '虚构其他成员', '', '', 'http://wx.qlogo.cn/fictional-avatar')"])
  const avatar = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZioAAAAASUVORK5CYII=', 'base64')
  const headFile = fixture('head_image/head_image.db', ['CREATE TABLE head_image(username TEXT, image_buffer BLOB)', `INSERT INTO head_image VALUES('wxid_fixture', x'${avatar.toString('hex')}')`], false)
  for (let i = 0; i < 2; i++) fixture(`message/message_${i}.db`, [
    'CREATE TABLE Name2Id(user_name TEXT)', "INSERT INTO Name2Id VALUES('wxid_fixture')", "INSERT INTO Name2Id VALUES('wxid_other')",
    `CREATE TABLE ${table}(local_id INTEGER, server_id INTEGER, local_type INTEGER, create_time INTEGER, message_content TEXT, real_sender_id INTEGER)`,
    `INSERT INTO ${table} VALUES(${i + 1}, 9007199254740993, 1, ${1700000000 + i * 2}, CAST('虚构消息${i + 1}' AS BLOB), ${i + 1})`,
  ])
  const files = [session, headFile, path.join(dbRoot, 'contact/contact.db'), ...[0, 1].map(i => path.join(dbRoot, `message/message_${i}.db`))]
  const hashes = () => files.map(file => createHash('sha256').update(fs.readFileSync(file)).digest('hex'))
  const before = hashes()
  const client = new Wcdb4Client(key, account)
  assert.equal(client.getSessions()[0].username, room)
  assert.equal(client.getDisplayNames(['wxid_fixture']).get('wxid_fixture'), '虚构备注')
  const profiles = client.getProfiles(['wxid_fixture', 'wxid_other'])
  const localAvatar = profiles.get('wxid_fixture').avatar
  assert.match(localAvatar, /^wetrace-media:\/\/preview\//)
  const { readImagePreview } = await import('../src/main/image-preview-cache.ts')
  const preview = readImagePreview(new URL(localAvatar).pathname.slice(1))
  assert.equal(preview.mime, 'image/png'); assert.deepEqual(preview.data, avatar)
  assert.equal(profiles.get('wxid_other').avatar, 'https://wx.qlogo.cn/fictional-avatar')
  const messages = client.getMessages(room, 2)
  assert.deepEqual(messages.map(row => row.content), ['虚构消息1', '虚构消息2'])
  assert.deepEqual(messages.map(row => row.sender), ['wxid_fixture', 'wxid_other'])
  assert.equal(messages[0].isSend, true); assert.equal(messages[1].isSend, false)
  assert.equal(messages[0].serverId, '9007199254740993')
  assert.equal(client.getMessages(room, 1)[0].content, '虚构消息2')
  assert.equal(client.getMessages(room, 1, 1)[0].content, '虚构消息1')
  assert.equal(client.getMessages('missing@chatroom', 1).length, 0)
  assert.equal(client.aggregateConversation(room).total, 2)
  const source = client.indexSource(), stores = source.stores()
  assert.equal(stores.length, 2)
  for (const store of stores) {
    const watermark = source.watermark(store)
    assert.equal(watermark.count, 1)
    assert.equal(source.page(store, 0, watermark.maxId, 10).length, 1)
  }
  const direct = new WindowsWcdbDatabase(path.resolve('resources/wcdb/windows/x64/WCDB.dll'))
  assert.throws(() => direct.query(session, '42'.repeat(32), 'SELECT * FROM SessionTable'), /密钥或加密参数/)
  assert.equal(direct.query(session, key, 'SELECT * FROM SessionTable').length, 1)
  assert.throws(() => direct.query(session, key, 'DELETE FROM SessionTable'), /只读/)
  assert.throws(() => direct.query(session, key, 'PRAGMA journal_mode=WAL'), /只读/)
  const bridge = createWindowsBindings(path.resolve('resources/wcdb/windows/x64/WCDB.dll')), out = [0]
  bridge.openAccount(session, key, out)
  const outside = path.join(root, 'outside.db'); fs.copyFileSync(session, outside)
  assert.throws(() => bridge.execQuery(out[0], 'message', outside, 'SELECT 1', [null]), /当前账号/)
  assert.deepEqual(hashes(), before)
  console.log('Windows独立适配回归通过：会话、备注、文字、跨分库分页、发送人、64位ID、统计、索引、错误密钥、账号隔离及只读保护')
} finally { WindowsWcdbDatabase.closeAll(); fs.rmSync(root, { recursive: true, force: true }) }
