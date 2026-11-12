import { windowsNativeResources } from './native-resources'
import { wechatPlatformSupport } from './wechat-platform'
import { createHash } from 'node:crypto'
import type { IndexSource, IndexStore, IndexWatermark } from './chat-index'
import { aggregateMessageStores, type MessageStore } from './native-statistics'
import type { ConversationIndexSummary, SpeechStatsResult } from '../shared/types'
import fs from 'node:fs'
import path from 'node:path'
import koffi from 'koffi'
import { cacheImagePreview } from './image-preview-cache'
import { decodeContent, packedImageHash } from './message-decoding.ts'
import { stripGroupSender } from './message-content'
import { isValidDatabaseKey } from '../shared/database-key-format'

export interface WcdbSession {
  username: string
  nickname: string
  lastActive: number
  unreadCount: number
}

export interface WcdbMessage {
  id: string
  type: number
  createTime: number
  content: string
  isSend: boolean
  sender: string
  serverId?: string
  imageFileHash?: string
}

type HandleOut = [number]
type PointerOut = [unknown | null]
type NativeLibrary = ReturnType<typeof koffi.load>

interface NativeBindings {
  library: NativeLibrary
  openAccount: (sessionDbPath: string, key: string, handle: HandleOut) => number
  getSessions: (handle: number, out: PointerOut) => number
  getMessages: (
    handle: number,
    username: string,
    limit: number,
    offset: number,
    out: unknown[]
  ) => number
  getDisplayNames: (handle: number, usernamesJson: string, out: unknown[]) => number
  getAvatarUrls: (handle: number, usernamesJson: string, out: unknown[]) => number
  getHeadImageBuffers: (handle: number, usernamesJson: string, out: unknown[]) => number
  getMessageTableStats?: (handle: number, username: string, out: PointerOut) => number
  execQuery?: (handle: number, kind: string, dbPath: string, sql: string, out: PointerOut) => number
  getGroupMembers?: (handle: number, username: string, out: PointerOut) => number
  getGroupNicknames?: (handle: number, username: string, out: PointerOut) => number
  resolveVideoHardlink?: (handle: number, md5: string, dbPath: string, out: PointerOut) => number
  getEmoticonCdnUrl?: (handle: number, dbPath: string, md5: string, out: PointerOut) => number
  setMyWxid?: (handle: number, wxid: string) => number
  freeString: (pointer: unknown) => void
}

let cachedBindings: NativeBindings | null = null
let initializationError: Error | null = null

let nativePaths = { appPath: process.cwd(), resourcesPath: process.resourcesPath ?? process.cwd() }

export function configureWcdbPaths(paths: typeof nativePaths): void { nativePaths = paths }

function nativeLibraryPath(): string {
  if (process.platform === 'win32' && process.arch === 'x64') return windowsNativeResources([nativePaths.resourcesPath, path.join(nativePaths.appPath, 'resources')]).api
  const support = wechatPlatformSupport()
  if (!support.supported) throw new Error(support.error)
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const candidates = [
    process.env.WCDB_API_PATH,
    path.join(nativePaths.resourcesPath, 'wcdb', 'macos', arch, 'libwcdb_api.dylib'),
    path.join(nativePaths.appPath, 'resources', 'wcdb', 'macos', arch, 'libwcdb_api.dylib'),
    path.join(process.cwd(), 'resources', 'wcdb', 'macos', arch, 'libwcdb_api.dylib'),
  ].filter((candidate): candidate is string => Boolean(candidate))
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (!found) throw new Error(`找不到 WCDB 原生库：${candidates.join('、')}`)
  return found
}

function loadBindings(): NativeBindings {
  const apiPath = nativeLibraryPath()
  const libraryDirectory = path.dirname(apiPath)
  koffi.load(path.join(libraryDirectory, process.platform === 'win32' ? 'WCDB.dll' : 'libWCDB.dylib'))
  const library = koffi.load(apiPath)
  const initProtection = library.func('int32 InitProtection(const char* resourcePath)') as (
    resourcePath: string
  ) => number
  const resourceRoots = [...new Set([libraryDirectory, path.dirname(libraryDirectory), nativePaths.resourcesPath])]
  let protectionCode = -1
  for (const root of resourceRoots) {
    protectionCode = Number(initProtection(root))
    if (protectionCode === 0) break
  }
  if (protectionCode !== 0) throw new Error(`WCDB InitProtection 失败，错误码：${protectionCode}`)

  const init = library.func('int32 wcdb_init()') as () => number
  const initCode = Number(init())
  if (initCode !== 0 && initCode !== -1006) throw new Error(`WCDB 初始化失败，错误码：${initCode}`)

  let setMyWxid: NativeBindings['setMyWxid'] = undefined
  try {
    setMyWxid = library.func('int32 wcdb_set_my_wxid(int64 handle, const char* wxid)') as (
      handle: number,
      wxid: string
    ) => number
  } catch {
    // 旧桥接库没有该可选接口，不影响读取。
  }

  let getMessageTableStats: NativeBindings['getMessageTableStats']
  let execQuery: NativeBindings['execQuery']
  try { getMessageTableStats = library.func('int32 wcdb_get_message_table_stats(int64 handle, const char* sessionId, _Out_ void** outJson)') as NativeBindings['getMessageTableStats'] } catch {}
  try { execQuery = library.func('int32 wcdb_exec_query(int64 handle, const char* kind, const char* path, const char* sql, _Out_ void** outJson)') as NativeBindings['execQuery'] } catch {}

  let getGroupMembers: NativeBindings['getGroupMembers']
  try { getGroupMembers = library.func('int32 wcdb_get_group_members(int64 handle, const char* chatroomId, _Out_ void** outJson)') as NativeBindings['getGroupMembers'] } catch { /* Optional in older bridges. */ }

  let getGroupNicknames: NativeBindings['getGroupNicknames']
  try { getGroupNicknames = library.func('int32 wcdb_get_group_nicknames(int64 handle, const char* chatroomId, _Out_ void** outJson)') as NativeBindings['getGroupNicknames'] } catch { /* Optional in older bridges. */ }

  let getEmoticonCdnUrl: NativeBindings['getEmoticonCdnUrl']
  try { getEmoticonCdnUrl = library.func('int32 wcdb_get_emoticon_cdn_url(int64 handle, const char* dbPath, const char* md5, _Out_ void** outUrl)') as NativeBindings['getEmoticonCdnUrl'] } catch {}
  let resolveVideoHardlink: NativeBindings['resolveVideoHardlink']
  try { resolveVideoHardlink = library.func('int32 wcdb_resolve_video_hardlink_md5(int64 handle, const char* md5, const char* dbPath, _Out_ void** outJson)') as NativeBindings['resolveVideoHardlink'] } catch { /* Optional in older bridges. */ }
  return {
    resolveVideoHardlink,
    getEmoticonCdnUrl,
    library,
    openAccount: library.func(
      'int32 wcdb_open_account(const char* path, const char* key, _Out_ int64* handle)'
    ) as NativeBindings['openAccount'],
    getSessions: library.func(
      'int32 wcdb_get_sessions(int64 handle, _Out_ void** outJson)'
    ) as NativeBindings['getSessions'],
    getMessages: library.func(
      'int32 wcdb_get_messages(int64 handle, const char* username, int32 limit, int32 offset, _Out_ void** outJson)'
    ) as NativeBindings['getMessages'],
    getDisplayNames: library.func(
      'int32 wcdb_get_display_names(int64 handle, const char* usernamesJson, _Out_ void** outJson)'
    ) as NativeBindings['getDisplayNames'],
    getAvatarUrls: library.func(
      'int32 wcdb_get_avatar_urls(int64 handle, const char* usernamesJson, _Out_ void** outJson)'
    ) as NativeBindings['getAvatarUrls'],
    getHeadImageBuffers: library.func(
      'int32 wcdb_get_head_image_buffers(int64 handle, const char* usernamesJson, _Out_ void** outJson)'
    ) as NativeBindings['getHeadImageBuffers'],
    setMyWxid,
    getMessageTableStats,
    execQuery,
    getGroupMembers,
    getGroupNicknames,
    freeString: library.func('void wcdb_free_string(void* ptr)') as NativeBindings['freeString'],
  }
}

export function initializeWcdbNative(): void {
  if (cachedBindings || initializationError) {
    if (initializationError) throw initializationError
    return
  }
  try {
    cachedBindings = loadBindings()
  } catch (error) {
    initializationError = error instanceof Error ? error : new Error(String(error))
    throw initializationError
  }
}

function bindings(): NativeBindings {
  initializeWcdbNative()
  if (!cachedBindings) throw new Error('WCDB 原生接口未就绪')
  return cachedBindings
}

function value(row: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name]
    const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
    if (key) return row[key]
  }
  return undefined
}

function text(row: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const result = value(row, [name])
    if (typeof result !== 'string' && typeof result !== 'number') continue
    const normalized = String(result).trim()
    if (normalized) return normalized
  }
  return ''
}

function readStringMap(rows: unknown, valueNames: string[]): Map<string, string> {
  const result = new Map<string, string>()
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue
      const record = row as Record<string, unknown>
      const username = text(record, ['username', 'userName', 'user_name', 'm_nsUsrName', 'wxid'])
      const itemValue = text(record, valueNames)
      if (username && itemValue) result.set(username, itemValue)
    }
    return result
  }
  if (!rows || typeof rows !== 'object') return result
  for (const [username, itemValue] of Object.entries(rows)) {
    if (itemValue && typeof itemValue === 'object' && !Array.isArray(itemValue)) {
      const item = text(itemValue as Record<string, unknown>, valueNames)
      if (item) result.set(username, item)
      continue
    }
    if ((typeof itemValue === 'string' || typeof itemValue === 'number') && String(itemValue).trim()) {
      result.set(username, String(itemValue).trim())
    }
  }
  return result
}

function avatarHexToDataUrl(raw: string): string | undefined {
  const hex = raw.trim()
  if (!hex || hex.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(hex)) return undefined
  const buffer = Buffer.from(hex, 'hex')
  let mime = 'image/jpeg'
  if (buffer.length >= 8 && buffer.subarray(1, 4).toString('ascii') === 'PNG') mime = 'image/png'
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    mime = 'image/webp'
  }
  return cacheImagePreview(buffer, mime)
}

function numberValue(row: Record<string, unknown>, names: string[]): number {
  const result = Number(value(row, names))
  return Number.isFinite(result) ? result : 0
}

function seconds(result: number): number {
  return Math.floor(result > 1e12 ? result / 1000 : result)
}

function messageContent(row: Record<string, unknown>): string {
  const compressed = decodeContent(value(row, [
    'compress_content',
    'compressContent',
    'msg_compress_content',
    'msgCompressContent',
    'WCDB_CT_compress_content',
    'WCDB_CT_compressContent',
  ]))
  if (compressed) return compressed
  return decodeContent(value(row, [
    'message_content',
    'messageContent',
    'content',
    'msg_content',
    'msgContent',
    'WCDB_CT_message_content',
  ]))
}

export class Wcdb4Client {
  private handle: number | null = null
  private displayNames = new Map<string, { at: number; name: string }>()
  private groupMembers = new Map<string, { at: number; ids: string[] }>()
  private groupNames = new Map<string, { at: number; names: Map<string, string> }>()
  private readonly sessionDbPath: string

  constructor(
    private readonly rawKey: string,
    private readonly accountRoot: string
  ) {
    if (!isValidDatabaseKey(rawKey)) throw new Error('数据库密钥格式无效')
    this.sessionDbPath = path.join(accountRoot, 'db_storage', 'session', 'session.db')
    if (!fs.existsSync(this.sessionDbPath)) {
      throw new Error(`未找到微信会话数据库：${this.sessionDbPath}`)
    }
  }

  private selfUsernames(): string[] {
    const accountName = path.basename(this.accountRoot).trim()
    const wxid = accountName.match(/^(wxid_[^_]+)/i)?.[1] ?? accountName
    return [...new Set([wxid, accountName].filter(Boolean))]
  }

  open(): void {
    if (this.handle !== null) return
    const native = bindings()
    const output: HandleOut = [0]
    const result = native.openAccount(
      this.sessionDbPath,
      this.rawKey.trim().replace(/^0x/i, ''),
      output
    )
    if (result !== 0 || output[0] <= 0) {
      const detail = result === -1005 ? '，密钥与当前账号目录不匹配' : ''
      throw new Error(`WCDB 打开账号失败，错误码：${result}${detail}`)
    }
    this.handle = output[0]
    native.setMyWxid?.(this.handle, this.selfUsernames()[0])
  }

  private callJson<T>(call: (handle: number, output: PointerOut) => number): T {
    this.open()
    if (this.handle === null) throw new Error('WCDB 账号句柄无效')
    const output: PointerOut = [null]
    const result = call(this.handle, output)
    if (result !== 0 || !output[0]) throw new Error(`WCDB 读取失败，错误码：${result}`)
    const pointer = output[0]
    try {
      return JSON.parse(koffi.decode(pointer, 'char', -1)) as T
    } finally {
      bindings().freeString(pointer)
    }
  }

  getVoiceData(username: string, row: WcdbMessage): { hex?: string; unavailable?: string } {
    this.open()
    const native = bindings()
    const output: PointerOut = [null]
    try {
      const read = native.library.func('int32 wcdb_get_voice_data(int64 handle, const char* sessionId, int32 createTime, int32 localId, int64 svrId, const char* candidatesJson, _Out_ void** outHex)')
      const code = read(this.handle, username, row.createTime, /^\d+$/.test(row.id) ? Number(row.id) : 0, BigInt(row.serverId || '0'), '[]', output)
      if (Number(code) !== 0 || !output[0]) return { unavailable: '本机未找到语音数据' }
      const hex = String(koffi.decode(output[0], 'char', -1)).trim()
      return /^[a-f\d]+$/i.test(hex) && hex.length % 2 === 0 ? { hex } : { unavailable: '语音数据格式无效' }
    } catch { return { unavailable: '当前数据库桥接无法读取语音' } }
    finally { if (output[0]) native.freeString(output[0]) }
  }

  getSessions(): WcdbSession[] {
    const rows = this.callJson<Record<string, unknown>[]>((handle, output) =>
      bindings().getSessions(handle, output)
    )
    if (!Array.isArray(rows)) return []
    return rows
      .map((row) => ({
        username: text(row, ['username', 'user_name', 'userName', 'm_nsUsrName', 'talker', 'sessionId']),
        nickname: text(row, ['remark', 'nick_name', 'nickname', 'nickName', 'displayName', 'm_nsNickName', 'name']),
        lastActive: seconds(numberValue(row, ['last_timestamp', 'lastTimestamp', 'last_time', 'lastActive'])),
        unreadCount: numberValue(row, ['unread_count', 'unreadCount', 'unread', 'unreadCountHint']),
      }))
      .filter((session) => session.username)
  }

  getDisplayNames(usernames: string[]): Map<string, string> {
    const requested = [...new Set(usernames.filter(Boolean))]
    const missing = requested.filter(id => Date.now() - (this.displayNames.get(id)?.at ?? 0) > 15_000)
    if (missing.length) {
      try {
        const names = readStringMap(this.callJson<unknown>((handle, output) =>
          bindings().getDisplayNames(handle, JSON.stringify(missing), output)),
          ['remark', 'nick_name', 'nickname', 'nickName', 'displayName', 'display_name', 'name'])
        for (const id of missing) this.displayNames.set(id, { at: Date.now(), name: names.get(id) || id })
        if (this.displayNames.size > 5000) this.displayNames.clear()
      } catch { /* Names are optional; preserve ids when unavailable. */ }
    }
    return new Map(requested.map(id => [id, this.displayNames.get(id)?.name || id]))
  }

  getProfiles(usernames: string[]): Map<string, { nickname?: string; avatar?: string }> {
    const normalized = [...new Set(usernames.map((username) => username.trim()).filter(Boolean))]
    const names = new Map<string, string>()
    const avatars = new Map<string, string>()
    if (!normalized.length) return new Map()

    try {
      const rows = this.callJson<unknown>((handle, output) =>
        bindings().getDisplayNames(handle, JSON.stringify(normalized), output)
      )
      readStringMap(rows, [
        'remark',
        'nick_name',
        'nickname',
        'nickName',
        'displayName',
        'display_name',
        'name',
      ]).forEach((name, username) => names.set(username, name))
    } catch {
      // 昵称是可选资料，读取失败时保留 wxid 作为界面降级。
    }

    try {
      const rows = this.callJson<unknown>((handle, output) =>
        bindings().getHeadImageBuffers(handle, JSON.stringify(normalized), output)
      )
      readStringMap(rows, ['image_hex', 'hex', 'data', 'buffer']).forEach((hex, username) => {
        const avatar = avatarHexToDataUrl(hex)
        if (avatar) avatars.set(username, avatar)
      })
    } catch {
      // 本地头像不可用时继续尝试头像 URL。
    }

    const missingAvatars = normalized.filter((username) => !avatars.has(username))
    if (missingAvatars.length) {
      try {
        const rows = this.callJson<unknown>((handle, output) =>
          bindings().getAvatarUrls(handle, JSON.stringify(missingAvatars), output)
        )
        readStringMap(rows, [
          'avatarUrl',
          'avatar_url',
          'headImgUrl',
          'm_nsHeadImgUrl',
          'big_head_img_url',
          'small_head_img_url',
        ]).forEach((avatar, username) => avatars.set(username, avatar))
      } catch {
        // 头像是可选资料，失败不影响消息同步。
      }
    }

    return new Map(
      normalized.map((username) => [
        username,
        { nickname: names.get(username) || undefined, avatar: avatars.get(username) },
      ])
    )
  }

  getSelfProfile(): { nickname?: string; avatar?: string } {
    const usernames = this.selfUsernames()
    const profiles = this.getProfiles(usernames)
    let nickname = ''
    let avatar = ''
    for (const username of usernames) {
      const profile = profiles.get(username)
      nickname ||= profile?.nickname ?? ''
      avatar ||= profile?.avatar ?? ''
    }
    return { nickname: nickname || undefined, avatar: avatar || undefined }
  }

  aggregateConversation(username: string, range?: { start: number; end: number; selfId: string }): ConversationIndexSummary | SpeechStatsResult {
    const native = bindings()
    if (!native.getMessageTableStats || !native.execQuery) throw new Error('当前数据库组件不支持轻量统计，请更新组件')
    const raw = this.callJson<Record<string, unknown>[]>((handle, output) => native.getMessageTableStats!(handle, username, output))
    if (!Array.isArray(raw)) throw new Error('消息表信息格式无效')
    const stores = raw.map(row => ({ tableName: text(row, ['table_name', 'tableName', 'name']), dbPath: text(row, ['db_path', 'dbPath', 'path']) }))
    if (!stores.length || stores.some(store => !store.tableName || !store.dbPath)) throw new Error('未找到该群的消息表')
    const unique = [...new Map(stores.map(store => [JSON.stringify([store.dbPath, store.tableName]), store])).values()]
    return aggregateMessageStores(unique, (store: MessageStore, sql) => {
      const rows = this.callJson<unknown>((handle, output) => native.execQuery!(handle, 'message', store.dbPath, sql, output))
      if (!Array.isArray(rows)) throw new Error('消息统计返回格式无效')
      return rows as Record<string, unknown>[]
    }, range)
  }

  indexSource(): IndexSource {
    const native = bindings()
    if (!native.execQuery) throw new Error('当前数据库组件不支持聊天索引')
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
    const sql = (dbPath: string, statement: string): Record<string, unknown>[] => {
      const rows = this.callJson<unknown>((handle, output) => native.execQuery!(handle, 'message', dbPath, statement, output))
      if (!Array.isArray(rows)) throw new Error('聊天索引读取格式无效')
      return rows as Record<string, unknown>[]
    }
    const schemas = new Map<string, { id: string; time: string; type: string; content?: string; join: string }>()
    const schema = (store: IndexStore) => {
      const cached = schemas.get(store.id)
      if (cached) return cached
      const columns = new Set(sql(store.dbPath, `PRAGMA table_info(${quote(store.tableName)})`).map(row => String(row.name)))
      const pick = (names: string[]) => names.find(name => columns.has(name))
      const id = pick(['local_id', 'localId', 'msg_local_id', 'mesLocalID', 'id'])
      const time = pick(['create_time', 'createTime', 'msg_create_time'])
      const type = pick(['local_type', 'localType', 'message_type', 'messageType', 'msg_type', 'type'])
      if (!id || !time || !type) throw new Error(`消息表结构不支持：${store.tableName}`)
      let join = ''
      if (columns.has('real_sender_id')) {
        const names = sql(store.dbPath, "SELECT name FROM sqlite_master WHERE type='table' AND lower(name) LIKE 'name2id%' ORDER BY name")[0]?.name
        if (names) {
          const nameColumns = new Set(sql(store.dbPath, `PRAGMA table_info(${quote(String(names))})`).map(row => String(row.name)))
          const name = ['user_name', 'username', 'userName'].find(column => nameColumns.has(column))
          if (name) join = ` LEFT JOIN ${quote(String(names))} AS n ON n.rowid=m.real_sender_id`
          if (name) join += `|n.${quote(name)}`
        }
      }
      const result = { id, time, type, content: pick(['message_content', 'messageContent', 'content', 'msg_content']), join }
      schemas.set(store.id, result)
      return result
    }
    return {
      stores: () => {
        const rooms = new Map<string, string>()
        const remember = (username: string) => { if (username) rooms.set(createHash('md5').update(username).digest('hex'), username) }
        for (const session of this.getSessions()) remember(session.username)
        const directory = path.join(path.dirname(this.sessionDbPath), '..', 'message')
        const stores: IndexStore[] = []
        for (const file of fs.readdirSync(directory).filter(name => /^(?:biz_)?message(?:_\d+)?\.db$/i.test(name)).sort()) {
          const dbPath = path.join(directory, file)
          const tables = sql(dbPath, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map(row => String(row.name))
          for (const table of tables.filter(name => /^Name2Id/i.test(name))) {
            const columns = new Set(sql(dbPath, `PRAGMA table_info(${quote(table)})`).map(row => String(row.name)))
            const column = ['user_name', 'username', 'userName'].find(name => columns.has(name))
            if (column) for (const row of sql(dbPath, `SELECT ${quote(column)} AS username FROM ${quote(table)}`)) remember(String(row.username || ''))
          }
          for (const tableName of tables.filter(name => /^Msg_[a-f0-9]{32}$/i.test(name))) {
            const hash = tableName.slice(4).toLowerCase()
            const room = rooms.get(hash) || `unmapped:${hash}`
            stores.push({ id: createHash('sha256').update(`${dbPath}:${tableName}`).digest('hex'), room, tableName, dbPath })
          }
        }
        if (!stores.length) throw new Error('没有找到可索引的聊天消息表')
        // A later shard may contain the Name2Id entry of an earlier table.
        return stores.map(store => ({ ...store, room: store.room.startsWith('unmapped:') ? rooms.get(store.tableName.slice(4).toLowerCase()) || store.room : store.room }))
      },
      watermark: (store, through) => {
        const columns = schema(store)
        const row = sql(store.dbPath, `SELECT COUNT(*) AS count, COALESCE(MAX(${quote(columns.id)}),0) AS maxId, COALESCE(SUM(${quote(columns.type)}),0) AS types, COALESCE(SUM(${quote(columns.time)}),0) AS times, ${columns.content ? `COALESCE(SUM(length(${quote(columns.content)})),0)` : '0'} AS lengths FROM ${quote(store.tableName)}${through === undefined ? '' : ` WHERE ${quote(columns.id)}<=${through}`}`)[0]
        if (!row) throw new Error('读取消息水位失败')
        return { count: Number(row.count), maxId: Number(row.maxId), types: Number(row.types), times: Number(row.times), lengths: Number(row.lengths) } as IndexWatermark
      },
      page: (store, after, through, limit) => {
        const columns = schema(store)
        const [join = '', sender = ''] = columns.join.split('|')
        const rows = sql(store.dbPath, `SELECT m.*${sender ? `, ${sender} AS sender_username` : ''} FROM ${quote(store.tableName)} AS m${join} WHERE m.${quote(columns.id)}>${after} AND m.${quote(columns.id)}<=${through} ORDER BY m.${quote(columns.id)} LIMIT ${limit}`)
        return this.normalizeMessages(rows, store.room, limit)
      },
    }
  }

  resolveVideoFilename(md5: string): string | undefined {
    if (!/^[a-f\d]{32}$/i.test(md5)) return undefined
    const read = bindings().resolveVideoHardlink
    if (!read) return undefined
    const databases = [path.join(this.accountRoot, 'db_storage/hardlink/hardlink.db'), path.join(this.accountRoot, 'db_storage/hardlink.db')]
    for (const database of databases) {
      if (!fs.existsSync(database)) continue
      try {
        const result = this.callJson<{ success?: boolean; resolved_md5?: unknown }>((handle, output) => read(handle, md5.toLowerCase(), database, output))
        if (result.success && typeof result.resolved_md5 === 'string') return result.resolved_md5
      } catch { /* Keep direct filename lookup available if the mapping is unavailable. */ }
    }
    return undefined
  }

  resolveEmoticonCdnUrl(md5: string): string | undefined {
    if (!/^[a-f\d]{32}$/i.test(md5)) return undefined
    const native = bindings(), read = native.getEmoticonCdnUrl
    if (!read) throw new Error('当前数据库组件不支持查询表情包下载地址')
    this.open()
    const database = ['emoticon', 'emotion'].map(folder => path.join(this.accountRoot, 'db_storage', folder, 'emoticon.db')).find(file => fs.existsSync(file))
    if (!database) return undefined
    const output: PointerOut = [null]
    try {
      const result = read(this.handle!, database, md5.toLowerCase(), output)
      if (result !== 0 || !output[0]) return undefined
      return String(koffi.decode(output[0], 'char', -1)).trim() || undefined
    } finally { if (output[0]) native.freeString(output[0]) }
  }

  getGroupMemberIds(username: string): string[] {
    const cached = this.groupMembers.get(username)
    if (cached && Date.now() - cached.at < 15_000) return cached.ids
    const read = bindings().getGroupMembers
    if (!read) throw new Error('当前数据库组件不支持读取群成员')
    const rows = this.callJson<unknown>((handle, output) => read(handle, username, output))
    if (!Array.isArray(rows)) throw new Error('群成员名单格式无效')
    const ids = rows.map(row => row && typeof row === 'object'
      ? text(row as Record<string, unknown>, ['username', 'userName', 'user_name', 'member_username', 'm_nsUsrName']) : '').filter(Boolean)
    if (!ids.length) throw new Error('本地未找到当前群成员名单')
    const unique = [...new Set(ids)]
    this.groupMembers.set(username, { at: Date.now(), ids: unique })
    return unique
  }

  getGroupNicknames(username: string): Map<string, string> {
    const cached = this.groupNames.get(username)
    if (cached && Date.now() - cached.at < 60_000) return cached.names
    const read = bindings().getGroupNicknames
    if (!read) return new Map()
    try {
      const rows = this.callJson<unknown>((handle, output) => read(handle, username, output))
      const names = readStringMap(rows, ['display_name', 'displayName', 'nickname', 'nick_name', 'name'])
      this.groupNames.set(username, { at: Date.now(), names })
      return names
    } catch { return cached?.names ?? new Map() }
  }

  getMessages(username: string, limit = 60, offset = 0, metadataOnly = false): WcdbMessage[] {
    const rows = this.callJson<Record<string, unknown>[]>((handle, output) =>
      bindings().getMessages(handle, username, limit, offset, output)
    )
    return this.normalizeMessages(rows, username, limit, offset, metadataOnly)
  }

  private normalizeMessages(rows: Record<string, unknown>[], username: string, limit: number, offset = 0, metadataOnly = false): WcdbMessage[] {
    if (!Array.isArray(rows)) return []
    return rows
      .map((row, index) => {
        const createTime = seconds(numberValue(row, [
          'create_time',
          'createTime',
          'msg_create_time',
          'msgCreateTime',
          'WCDB_CT_create_time',
        ]))
        const isSend = Boolean(numberValue(row, [
          'computed_is_send', 'computedIsSend', 'is_send', 'isSend', 'WCDB_CT_is_send',
        ])) || numberValue(row, ['mesDes']) === 0 && value(row, ['mesDes']) !== undefined
        const explicitSender = text(row, [
          'sender_username', 'senderUsername', 'sender', 'from_username', 'WCDB_CT_sender_username',
        ])
        // Statistical reads only decode content when the sender is embedded in it.
        const content = !metadataOnly || (!explicitSender && !isSend) ? messageContent(row) : ''
        const groupContent = username.endsWith('@chatroom') ? stripGroupSender(content) : { sender: '', content }
        const sender = explicitSender || groupContent.sender
        return {
          id: text(row, ['local_id', 'localId', 'msg_local_id', 'mesLocalID', 'id']) || `${createTime}-${offset + index}`,
          type: numberValue(row, ['local_type', 'localType', 'message_type', 'messageType', 'msg_type', 'type']) || 1,
          createTime,
          content: groupContent.content,
          isSend,
          sender,
          serverId: text(row, ['server_id', 'serverId', 'msg_svr_id', 'msgSvrId', 'mesSvrID']),
          imageFileHash: metadataOnly ? undefined : packedImageHash(value(row, ['packed_info_data', 'packedInfoData', 'packed_info', 'BytesExtra', 'WCDB_CT_packed_info'])),
        }
      })
      .sort((left, right) => left.createTime - right.createTime)
      .slice(-limit)
  }
}

export function testDatabaseConnection(rawKey: string, accountRoot: string): void {
  const client = new Wcdb4Client(rawKey, accountRoot)
  client.open()
  const sessions = client.getSessions()
  if (sessions[0]) client.getMessages(sessions[0].username, 1)
}
