// Feasibility probe: only creates and reads a disposable synthetic database.
// Does not load wcdb_api.dll, inspect WeChat, or capture a key.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import koffi from 'koffi'
assert.equal(process.platform, 'win32')
const library = koffi.load(path.resolve('resources/wcdb/windows/x64/WCDB.dll'))
// Public Tencent WCDB ObjectBridge/CoreBridge/HandleBridge interfaces.
const object = koffi.struct('WeTraceDirectObject', { innerValue: 'void*' })
const bind = (name, result, args) => library.func(name, result, args)
const create = bind('WCDBCoreCreateDatabase', object, ['str', 'bool', 'bool'])
const cipher = bind('WCDBDatabaseConfigCipher', 'void', [object, 'void*', 'int', 'int', 'int'])
const open = bind('WCDBDatabaseCanOpen', 'bool', [object])
const handle = bind('WCDBDatabaseGetHandle', object, [object, 'bool'])
const execute = bind('WCDBHandleExecuteSQL', 'bool', [object, 'str'])
const statement = bind('WCDBHandleGetMainStatement', object, [object])
const prepare = bind('WCDBHandleStatementPrepareSQL', 'bool', [object, 'str'])
const step = bind('WCDBHandleStatementStep', 'bool', [object])
const done = bind('WCDBHandleStatementIsDone', 'bool', [object])
const text = bind('WCDBHandleStatementGetText', 'str', [object, 'int'])
const readonly = bind('WCDBHandleStatementIsReadOnly', 'bool', [object])
const finalize = bind('WCDBHandleStatementFinalize', 'void', [object])
const release = bind('WCDBReleaseCPPObject', 'void', ['void*'])
const close = bind('WCDBDatabaseClose', 'void', [object, 'void*', 'void*'])
const purge = bind('WCDBDatabasePurge', 'void', [object])
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wetrace-direct-'))
const file = path.join(root, '虚构加密样例.db')
const key = Buffer.alloc(32, 0x41)
function database(readOnly) {
  const db = create(file, readOnly, false)
  cipher(db, key, key.length, 4096, 4)
  assert.equal(open(db), true, '加密样例打开失败')
  return db
}
function dispose(db, h) { if (h) release(h.innerValue); close(db, null, null); purge(db); release(db.innerValue) }
try {
  let db = database(false), h = handle(db, true)
  try {
    assert.equal(execute(h, 'CREATE TABLE fixture(id INTEGER PRIMARY KEY, content TEXT)'), true)
    assert.equal(execute(h, "INSERT INTO fixture VALUES(1, '虚构测试消息')"), true)
  } finally { dispose(db, h) }
  const hash = () => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  assert.notEqual(fs.readFileSync(file).subarray(0, 16).toString(), 'SQLite format 3\0')
  const before = hash()
  db = database(true); h = handle(db, false)
  try {
    const s = statement(h)
    try {
      assert.equal(prepare(s, 'SELECT content FROM fixture WHERE id=1'), true)
      assert.equal(readonly(s), true)
      assert.equal(step(s), true); assert.equal(done(s), false)
      assert.equal(text(s, 0), '虚构测试消息')
      assert.equal(step(s), true); assert.equal(done(s), true)
    } finally { finalize(s); release(s.innerValue) }
    assert.equal(execute(h, "INSERT INTO fixture VALUES(2, '应拒绝写入')"), false, '只读数据库必须拒绝写入')
  } finally { dispose(db, h) }
  assert.equal(hash(), before, '只读测试不得改变数据库')
  console.log('独立WCDB接口验证通过：加密数据库、中文路径、SQL查询、拒绝写入、文件哈希不变；未加载TraceMemo桥接库')
} finally { fs.rmSync(root, { recursive: true, force: true }) }
