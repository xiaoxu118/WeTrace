import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import koffi from 'koffi'
import type { NativeBindings } from './wcdb4-client'

type Row = Record<string, unknown>
type ObjectHandle = { innerValue: unknown }
type NativeFunction = ReturnType<ReturnType<typeof koffi.load>['func']>
type NativeType = string | ReturnType<typeof koffi.struct>
type Connection = { db: ObjectHandle; handle: ObjectHandle; key: string; timer?: ReturnType<typeof setTimeout>; close: () => void }
const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`
const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`
const field = (columns: string[], candidates: string[]): string | undefined => candidates.find(name => columns.includes(name))

/** Tencent's public C bridge, without the application-specific wcdb_api layer. */
export class WindowsWcdbDatabase {
  private static readonly connections = new Map<string, Connection>()
  static closeAll(): void {
    for (const connection of this.connections.values()) connection.close()
    this.connections.clear()
  }
  readonly library: ReturnType<typeof koffi.load>
  private readonly api: Record<string, NativeFunction>

  constructor(file: string) {
    this.library = koffi.load(file)
    if (process.env.WETRACE_STORAGE_ROOT) {
      const temporary = path.join(process.env.WETRACE_STORAGE_ROOT, 'temp')
      const configureTemporary = this.library.func('bool WCDBCoreSetDefaultTemporaryDirectory(const char* directory)')
      if (!configureTemporary(temporary)) throw new Error('无法设置安装目录内的数据库临时路径')
    }
    const object = koffi.struct({ innerValue: 'void*' })
    const bind = (name: string, result: NativeType, args: NativeType[]): NativeFunction => this.library.func(name, result, args)
    this.api = {
      create: bind('WCDBCoreCreateDatabase', object, ['str', 'bool', 'bool']),
      cipher: bind('WCDBDatabaseConfigCipher', 'void', [object, 'void*', 'int', 'int', 'int']),
      open: bind('WCDBDatabaseCanOpen', 'bool', [object]),
      handle: bind('WCDBDatabaseGetHandle', object, [object, 'bool']),
      statement: bind('WCDBHandleGetMainStatement', object, [object]),
      prepare: bind('WCDBHandleStatementPrepareSQL', 'bool', [object, 'str']),
      step: bind('WCDBHandleStatementStep', 'bool', [object]),
      done: bind('WCDBHandleStatementIsDone', 'bool', [object]),
      readonly: bind('WCDBHandleStatementIsReadOnly', 'bool', [object]),
      count: bind('WCDBHandleStatementGetColumnCount', 'int', [object]),
      name: bind('WCDBHandleStatementGetColumnName', 'str', [object, 'int']),
      type: bind('WCDBHandleStatementGetColumnType', 'int', [object, 'int']),
      integer: bind('WCDBHandleStatementGetInteger', 'int64', [object, 'int']),
      double: bind('WCDBHandleStatementGetDouble', 'double', [object, 'int']),
      text: bind('WCDBHandleStatementGetText', 'str', [object, 'int']),
      blob: bind('WCDBHandleStatementGetBlob', 'void*', [object, 'int']),
      size: bind('WCDBHandleStatementGetColumnSize', 'int64', [object, 'int']),
      finalize: bind('WCDBHandleStatementFinalize', 'void', [object]),
      release: bind('WCDBReleaseCPPObject', 'void', ['void*']),
      close: bind('WCDBDatabaseClose', 'void', [object, 'void*', 'void*']),
      purge: bind('WCDBDatabasePurge', 'void', [object]),
      databaseError: bind('WCDBDatabaseGetError', object, [object]),
      statementError: bind('WCDBHandleStatementGetError', object, [object]),
      errorCode: bind('WCDBErrorGetCode', 'long', [object]),
    }
  }

  query(file: string, key: string, sql: string): Row[] {
    if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('数据库密钥格式无效')
    if (!/^\s*(SELECT\b|PRAGMA\s+table_info\s*\()/i.test(sql)) throw new Error('Windows数据库接口仅允许只读查询')
    if (!fs.statSync(file).isFile()) throw new Error('微信数据库文件不可用')
    const a = this.api
    const identity = fs.realpathSync.native(file).toLowerCase()
    let connection = WindowsWcdbDatabase.connections.get(identity)
    if (connection && connection.key !== key) { connection.close(); connection = undefined }
    const db = connection?.db ?? a.create(file, true, false) as ObjectHandle
    let h: ObjectHandle | undefined = connection?.handle, s: ObjectHandle | undefined
    const failure = (stage: string): Error => {
      const error = (s ? a.statementError(s) : a.databaseError(db)) as ObjectHandle
      try {
        const code = Number(a.errorCode(error))
        const reason = code === 26 ? '密钥或加密参数与数据库不匹配' : code === 5 || code === 6 ? '数据库正忙，请稍后重试' : code === 14 ? '数据库文件不可读，请检查路径和权限' : '表结构或数据库状态不兼容'
        return new Error(`${stage}：${reason}（WCDB ${code}）`)
      } finally { a.release(error.innerValue) }
    }
    try {
      // WeChat's captured hex represents 32 key bytes, not SQLCipher's x'...' raw-key syntax.
      // Match the native account opener: 4096-byte pages, WCDB default cipher configuration.
      if (!connection) {
        const header = Buffer.alloc(16)
        const descriptor = fs.openSync(file, 'r')
        try { fs.readSync(descriptor, header, 0, header.length, 0) } finally { fs.closeSync(descriptor) }
        if (header.toString('ascii') !== 'SQLite format 3\0') {
          const cipherKey = Buffer.from(key, 'hex')
          a.cipher(db, cipherKey, cipherKey.length, 4096, 0)
        }
        if (!a.open(db)) throw failure('无法只读打开微信数据库')
        h = a.handle(db, false) as ObjectHandle
        const ownedHandle = h
        connection = { db, handle: h, key, close: () => {
          if (connection?.timer) clearTimeout(connection.timer)
          WindowsWcdbDatabase.connections.delete(identity)
          a.release(ownedHandle.innerValue); a.close(db, null, null); a.purge(db); a.release(db.innerValue)
        } }
        WindowsWcdbDatabase.connections.set(identity, connection)
        if (WindowsWcdbDatabase.connections.size > 64) WindowsWcdbDatabase.connections.values().next().value?.close()
      }
      s = a.statement(h) as ObjectHandle
      if (!a.prepare(s, sql)) throw failure('微信数据库查询准备失败')
      if (!a.readonly(s)) throw new Error('Windows数据库接口拒绝写入语句')
      const rows: Row[] = []
      const count = Number(a.count(s))
      while (true) {
        if (!a.step(s)) throw failure('微信数据库查询失败')
        if (a.done(s)) break
        const row: Row = {}
        for (let i = 0; i < count; i++) {
          const name = String(a.name(s, i))
          switch (Number(a.type(s, i))) {
            case 1: { const value = a.integer(s, i) as number | bigint; row[name] = typeof value === 'bigint' ? (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : String(value)) : value; break }
            case 2: row[name] = Number(a.double(s, i)); break
            case 3: row[name] = a.text(s, i); break
            case 4: { const size = Number(a.size(s, i)); if (!Number.isSafeInteger(size) || size < 0 || size > 64 * 1024 * 1024) throw new Error('数据库字段过大'); row[name] = size ? Buffer.from(koffi.decode(a.blob(s, i), 'uint8_t', size) as number[]) : Buffer.alloc(0); break }
            default: row[name] = null
          }
        }
        rows.push(row)
      }
      return rows
    } finally {
      if (s) { a.finalize(s); a.release(s.innerValue) }
      if (connection) {
        if (connection.timer) clearTimeout(connection.timer)
        connection.timer = setTimeout(() => connection?.close(), 60_000)
        connection.timer.unref()
      } else {
        if (h) a.release(h.innerValue)
        a.close(db, null, null); a.purge(db); a.release(db.innerValue)
      }
    }
  }
}

export function createWindowsBindings(file: string): NativeBindings {
  const engine = new WindowsWcdbDatabase(file)
  const accounts = new Map<number, { root: string; key: string; self: string }>()
  let nextHandle = 1
  const account = (id: number) => { const value = accounts.get(id); if (!value) throw new Error('Windows数据库账号句柄无效'); return value }
  const query = (id: number, file: string, sql: string): Row[] => {
    const current = account(id)
    const resolved = fs.realpathSync.native(file)
    const relative = path.relative(current.root, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('数据库路径不属于当前账号')
    return engine.query(resolved, current.key, sql)
  }
  const schemaCache = new Map<string, { at: number; values: string[] }>()
  const schema = (id: number, file: string, sql: string): string[] => {
    const cacheKey = `${id}:${file}:${sql}`
    const cached = schemaCache.get(cacheKey)
    if (cached && Date.now() - cached.at < 15_000) return cached.values
    const values = query(id, file, sql).map(row => String(row.name))
    if (schemaCache.size >= 4096) schemaCache.clear()
    schemaCache.set(cacheKey, { at: Date.now(), values })
    return values
  }
  const tables = (id: number, file: string) => schema(id, file, "SELECT name FROM sqlite_master WHERE type='table'")
  const columns = (id: number, file: string, table: string) => schema(id, file, `PRAGMA table_info(${quote(table)})`)
  const result = (output: unknown[], rows: unknown): number => { output[0] = Buffer.from(JSON.stringify(rows) + '\0'); return 0 }
  const stores = (id: number, username: string) => {
    const directory = path.join(account(id).root, 'message')
    if (!fs.existsSync(directory)) return []
    const expected = `Msg_${createHash('md5').update(username).digest('hex')}`
    return fs.readdirSync(directory).filter(name => /^message_\d+\.db$/i.test(name)).sort().flatMap(name => {
      const file = path.join(directory, name)
      const table = tables(id, file).find(name => name.toLowerCase() === expected.toLowerCase())
      return table ? [{ db_path: file, table_name: table }] : []
    })
  }
  const contacts = (id: number, ids: string[]) => {
    const file = path.join(account(id).root, 'contact', 'contact.db')
    if (!fs.existsSync(file)) return []
    const table = tables(id, file).find(name => /^contact$/i.test(name))
    if (!table) return []
    const names = columns(id, file, table), user = field(names, ['username', 'user_name', 'userName'])
    if (!user) throw new Error('联系人表缺少账号字段')
    return ids.length ? query(id, file, `SELECT *, ${quote(user)} AS username FROM ${quote(table)} WHERE ${quote(user)} IN (${ids.map(literal).join(',')})`) : []
  }
  return {
    library: engine.library,
    openAccount: (sessionFile, key, output) => {
      const root = fs.realpathSync.native(path.resolve(sessionFile, '..', '..'))
      engine.query(sessionFile, key, 'SELECT name FROM sqlite_master LIMIT 1')
      const self = path.basename(path.dirname(root)).match(/^(wxid_[^_]+)/)?.[1] ?? ''
      const existing = [...accounts].find(([, value]) => value.root === root && value.key === key)
      const id = existing?.[0] ?? nextHandle++
      accounts.set(id, { root, key, self }); output[0] = id; return 0
    },
    setMyWxid: (id, self) => { account(id).self = self; return 0 },
    getSessions: (id, output) => {
      const file = path.join(account(id).root, 'session', 'session.db')
      const table = tables(id, file).find(name => /^(SessionTable|session)$/i.test(name))
      if (!table) throw new Error('尚未适配当前微信会话表')
      const names = columns(id, file, table)
      const user = field(names, ['username', 'user_name', 'userName'])
      if (!user) throw new Error('会话表缺少账号字段')
      return result(output, query(id, file, `SELECT *, ${quote(user)} AS username FROM ${quote(table)}`))
    },
    getDisplayNames: (id, input, output) => result(output, contacts(id, JSON.parse(input))),
    getAvatarUrls: (id, input, output) => result(output, contacts(id, JSON.parse(input)).map(row => {
      const value = ['big_head_img_url', 'big_head_url', 'bigHeadImgUrl', 'bigHeadUrl', 'small_head_img_url', 'small_head_url', 'smallHeadImgUrl', 'smallHeadUrl', 'head_img_url', 'headImgUrl', 'avatar_url', 'avatarUrl'].map(name => row[name]).find(value => typeof value === 'string' && value.trim())
      const url = typeof value === 'string' ? value.trim().replace(/^http:\/\/(?=(?:[a-z0-9-]+\.)*(?:qlogo|qpic)\.cn(?:\/|$))/i, 'https://') : ''
      return { username: row.username, avatar_url: url }
    })),
    getHeadImageBuffers: (id, input, output) => {
      const ids = JSON.parse(input) as string[]
      if (!ids.length) return result(output, [])
      const candidates = ['head_image/head_image.db', 'head_image/HeadImage.db', 'head_image.db', 'contact/head_image.db']
      const file = candidates.map(name => path.join(account(id).root, name)).find(file => fs.existsSync(file))
      if (!file) return result(output, [])
      const table = tables(id, file).find(name => /^head_image$/i.test(name))
      if (!table) return result(output, [])
      const names = columns(id, file, table)
      const user = field(names, ['username', 'user_name']), image = field(names, ['image_buffer', 'image_data'])
      if (!user || !image) return result(output, [])
      return result(output, query(id, file, `SELECT ${quote(user)} AS username, hex(${quote(image)}) AS image_hex FROM ${quote(table)} WHERE ${quote(user)} IN (${ids.map(literal).join(',')})`))
    },
    getMessageTableStats: (id, username, output) => result(output, stores(id, username)),
    execQuery: (id, _kind, file, sql, output) => result(output, query(id, file, sql)),
    getMessages: (id, username, limit, offset, output) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('消息分页参数无效')
      const rows: Row[] = []
      for (const store of stores(id, username)) {
        const file = store.db_path, table = store.table_name, names = columns(id, file, table)
        const time = field(names, ['create_time', 'createTime', 'msg_create_time'])
        const local = field(names, ['local_id', 'localId', 'msg_local_id'])
        if (!time || !local) throw new Error('消息表缺少时间或记录ID字段')
        let join = '', sender = field(names, ['sender_username', 'from_username'])
        let expression = sender ? `m.${quote(sender)}` : "''"
        if (!sender && names.includes('real_sender_id')) {
          const mapping = tables(id, file).find(name => /^Name2Id/i.test(name))
          if (mapping) {
            sender = field(columns(id, file, mapping), ['user_name', 'username'])
            if (sender) { join = ` LEFT JOIN ${quote(mapping)} n ON n.rowid=m.real_sender_id`; expression = `n.${quote(sender)}` }
          }
        }
        const page = query(id, file, `SELECT m.*, ${expression} AS sender_username FROM ${quote(table)} m${join} ORDER BY m.${quote(time)} DESC, m.${quote(local)} DESC LIMIT ${limit + offset}`)
        for (const row of page) rows.push({ ...row, computed_is_send: Number(row.is_send ?? (row.sender_username === account(id).self)), __time: row[time], __id: row[local] })
      }
      rows.sort((a, b) => Number(b.__time) - Number(a.__time) || Number(b.__id) - Number(a.__id))
      return result(output, rows.slice(offset, offset + limit))
    },
    freeString: () => {}, // Output buffers are owned by JavaScript.
  }
}
