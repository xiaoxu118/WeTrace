import { DatabaseSync } from 'node:sqlite'
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, createHmac } from 'node:crypto'
import { mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatIndexStatus } from '../shared/chat-index'
import type { WcdbMessage } from './wcdb4-client'
import type { ReportContentType, ConversationIndexSummary, SpeechStatsResult } from '../shared/types'

export interface IndexWatermark { count: number; maxId: number; types: number; times: number; lengths: number }
export interface IndexStore { id: string; room: string; tableName: string; dbPath: string }
interface ImportCheckpoint { room: string; target: IndexWatermark; base: string | null; append: boolean; after: number; count: number }
export interface IndexSource {
  excluded?(room: string): boolean
  fingerprint?(): string
  stores(): IndexStore[]
  watermark(store: IndexStore, through?: number): IndexWatermark
  page(store: IndexStore, after: number, through: number, limit: number): WcdbMessage[]
}
const blank = (): ChatIndexStatus => ({ state: 'idle', messages: 0, conversations: 0, completedStores: 0, totalStores: 0, current: '', updatedAt: null, errors: [] })
const same = (a: IndexWatermark, b: IndexWatermark): boolean => JSON.stringify(a) === JSON.stringify(b)
const yieldWork = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

export class ChatIndex {
  private db: DatabaseSync
  private key: Buffer
  private running?: Promise<ChatIndexStatus>
  private paused = false
  private queued?: { source: IndexSource; rebuild: boolean }
  private selfId: string
  constructor(directory: string, account: string, secret: string, selfId: string) {
    this.selfId = selfId
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const identity = createHash('sha256').update(JSON.stringify([account, secret])).digest('hex')
    const file = join(directory, `${identity}.sqlite`)
    this.key = Buffer.from(hkdfSync('sha256', secret, identity, 'wetrace-chat-index-v1', 32))
    this.db = new DatabaseSync(file)
    chmodSync(file, 0o600)
    try {
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA recursive_triggers=ON;
      CREATE TABLE IF NOT EXISTS stores (id TEXT PRIMARY KEY, room TEXT NOT NULL, mark TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (source TEXT NOT NULL, id INTEGER NOT NULL, room TEXT NOT NULL, time INTEGER NOT NULL, sender TEXT NOT NULL, type INTEGER NOT NULL, payload BLOB NOT NULL, tokens TEXT NOT NULL, PRIMARY KEY(source,id));
      CREATE INDEX IF NOT EXISTS chat_room_time ON messages(room,time);
      CREATE INDEX IF NOT EXISTS chat_report_metadata ON messages(room,time,id,source,sender,type);
      CREATE INDEX IF NOT EXISTS chat_time ON messages(time);
      CREATE INDEX IF NOT EXISTS chat_room_sender_time ON messages(room,sender,time);
      CREATE TABLE IF NOT EXISTS planned (id TEXT PRIMARY KEY, room TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS staging (source TEXT NOT NULL, id INTEGER NOT NULL, room TEXT NOT NULL, time INTEGER NOT NULL, sender TEXT NOT NULL, type INTEGER NOT NULL, payload BLOB NOT NULL, tokens TEXT NOT NULL, PRIMARY KEY(source,id));
      CREATE VIRTUAL TABLE IF NOT EXISTS chat_search USING fts5(tokens, content='messages', content_rowid='rowid', detail=none, columnsize=0);
      CREATE TRIGGER IF NOT EXISTS chat_search_insert AFTER INSERT ON messages BEGIN INSERT INTO chat_search(rowid,tokens) VALUES(new.rowid,new.tokens); END;
      CREATE TRIGGER IF NOT EXISTS chat_search_delete AFTER DELETE ON messages BEGIN INSERT INTO chat_search(chat_search,rowid,tokens) VALUES('delete',old.rowid,old.tokens); END;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`)
    } catch (error) { this.db.close(); throw error }
  }
  close(): void { this.db.close() }
  status(): ChatIndexStatus {
    const saved = this.db.prepare("SELECT value FROM metadata WHERE key='status'").get()
    const status = saved ? JSON.parse(String(saved.value)) as ChatIndexStatus : blank()
    const row = this.db.prepare("SELECT COALESCE(SUM(json_extract(mark, '$.count')),0) AS messages, COUNT(DISTINCT room) AS conversations FROM stores").get()!
    return { ...status, messages: Number(row.messages), conversations: Number(row.conversations) }
  }
  exclude(rooms: string[]): void {
    // Every reader initializes its exclusion policy. An empty policy is not a write.
    if (!rooms.length) return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const room of rooms) {
        const ids = this.db.prepare('SELECT id FROM stores WHERE room=? UNION SELECT source AS id FROM staging WHERE room=? UNION SELECT id FROM planned WHERE room=?').all(room, room, room)
        for (const row of ids) {
          this.db.prepare('DELETE FROM metadata WHERE key IN (?,?)').run(`checkpoint:${row.id}`, `audit:${row.id}`)
        }
        for (const table of ['messages', 'staging', 'stores', 'planned']) this.db.prepare(`DELETE FROM ${table} WHERE room=?`).run(room)
      }
      this.db.prepare("DELETE FROM metadata WHERE key='source-fingerprint'").run()
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private save(status: ChatIndexStatus): void {
    this.db.prepare("INSERT OR REPLACE INTO metadata VALUES ('status', ?)").run(JSON.stringify(status))
  }
  pause(): ChatIndexStatus {
    this.paused = true
    this.queued = undefined
    const status = { ...this.status(), state: 'paused' as const }
    this.save(status)
    return status
  }
  start(source: IndexSource, rebuild = false): Promise<ChatIndexStatus> {
    if (this.running) {
      this.queued = { source, rebuild: rebuild || this.queued?.rebuild || false }
      return this.running
    }
    this.paused = false
    this.running = this.build(source, rebuild).finally(() => {
      this.running = undefined
      const queued = this.queued
      this.queued = undefined
      if (queued && !this.paused) void this.start(queued.source, queued.rebuild).catch(error => console.error('索引增量更新失败:', error instanceof Error ? error.message : String(error)))
    })
    return this.running
  }
  private tokens(content: string): string[] {
    const chars = [...content.toLocaleLowerCase()]
    const grams = new Set<string>()
    for (let i = 0; i < chars.length; i++) {
      grams.add(chars[i])
      if (i + 1 < chars.length) grams.add(chars[i] + chars[i + 1])
    }
    return [...grams].map(gram => `t${createHmac('sha256', this.key).update(gram).digest('hex').slice(0,24)}`)
  }
  search(keyword: string, limit = 30): { room: string; message: WcdbMessage }[] {
    const needle = keyword.trim().toLocaleLowerCase()
    if (!needle || needle.length > 200) return []
    const match = this.tokens(needle).slice(0,100).join(' AND ')
    const found: { room: string; message: WcdbMessage }[] = []
    const rows = this.db.prepare('SELECT m.source,m.id,m.payload,m.room FROM chat_search f JOIN messages m ON m.rowid=f.rowid WHERE chat_search MATCH ? ORDER BY m.time DESC').iterate(match)
    for (const row of rows) {
      const message = this.unseal(row)
      if (message.content.toLocaleLowerCase().includes(needle)) found.push({ room: String(row.room), message })
      if (found.length >= limit) break
    }
    return found
  }
  private seal(row: WcdbMessage, context: string): Buffer {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce)
    cipher.setAAD(Buffer.from(context))
    const content = Buffer.concat([cipher.update(JSON.stringify(row)), cipher.final()])
    return Buffer.concat([nonce, cipher.getAuthTag(), content])
  }
  private unseal(row: Record<string, unknown>): WcdbMessage {
    const bytes = Buffer.from(row.payload as Uint8Array)
    const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12))
    cipher.setAAD(Buffer.from(`${row.source}:${row.id}`))
    cipher.setAuthTag(bytes.subarray(12, 28))
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString()) as WcdbMessage
  }
  private async build(source: IndexSource, rebuild: boolean): Promise<ChatIndexStatus> {
    const status = { ...this.status(), state: 'building' as ChatIndexStatus['state'], completedStores: 0, totalStores: 0, errors: [] as string[], current: '' }
    this.save(status)
    try {
      const sourceVersion = source.fingerprint?.()
      const stores = source.stores().filter(store => !source.excluded?.(store.room))
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.exec('DELETE FROM planned')
        const plan = this.db.prepare('INSERT INTO planned VALUES (?, ?)')
        for (const store of stores) plan.run(store.id, store.room)
        this.db.exec('COMMIT')
      } catch (error) { this.db.exec('ROLLBACK'); throw error }
      status.totalStores = stores.length
      this.save(status)
      const insert = this.db.prepare('INSERT OR REPLACE INTO staging VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      storeLoop: for (const store of stores) {
        if (source.excluded?.(store.room)) { this.exclude([store.room]); continue }
        if (this.paused) break
        status.current = store.room
        this.save(status)
        try {
          const mark = source.watermark(store)
          const saved = this.db.prepare('SELECT mark,room FROM stores WHERE id=?').get(store.id)
          const audit = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(`audit:${store.id}`)
          const verifyHistory = rebuild || Boolean(saved && Date.now() - Number(audit?.value || 0) > 24 * 60 * 60 * 1000)
          const previous: IndexWatermark | undefined = saved ? JSON.parse(String(saved.mark)) : undefined
          if (!verifyHistory && saved?.room === store.room && previous && same(previous, mark)) { status.completedStores++; this.save(status); await yieldWork(); continue }
          let append = !verifyHistory && saved?.room === store.room && previous && mark.maxId >= previous.maxId && same(previous, source.watermark(store, previous.maxId))
          let after = append ? previous!.maxId : 0
          let readCount = 0
          const checkpointKey = `checkpoint:${store.id}`
          const checkpointRow = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(checkpointKey)
          let checkpoint: ImportCheckpoint | undefined
          try { checkpoint = checkpointRow ? JSON.parse(String(checkpointRow.value)) : undefined } catch { /* Invalid checkpoints restart only this store. */ }
          const staged = this.db.prepare('SELECT COUNT(*) AS count, MAX(id) AS last FROM staging WHERE source=?').get(store.id)!
          const canResume = !rebuild && checkpoint && checkpoint.room === store.room && checkpoint.base === (saved?.mark ?? null)
            && Number(staged.count) === checkpoint.count && Number(staged.last ?? 0) === checkpoint.after
            && same(checkpoint.target, source.watermark(store, checkpoint.target.maxId))
          if (canResume && checkpoint) {
            append = checkpoint.append
            after = checkpoint.after
            readCount = checkpoint.count
          } else {
            this.db.prepare('DELETE FROM staging WHERE source=?').run(store.id)
            this.db.prepare('DELETE FROM metadata WHERE key=?').run(checkpointKey)
          }
          while (after < mark.maxId && !this.paused) {
            const rows = source.page(store, after, mark.maxId, 1000)
            if (!rows.length) throw new Error('消息读取提前结束，保留已有索引')
            this.db.exec('BEGIN IMMEDIATE')
            try {
              for (const row of rows) {
                const id = Number(row.id)
                if (!Number.isSafeInteger(id) || id <= after || id > mark.maxId) throw new Error('消息编号无效')
                insert.run(store.id, id, store.room, row.createTime * 1000, row.isSend ? this.selfId : row.sender, row.type & 65535, this.seal({ ...row, type: row.type & 65535 }, `${store.id}:${id}`), this.tokens(row.content).join(' '))
              }
              const position = Math.max(...rows.map(row => Number(row.id)))
              const nextCheckpoint: ImportCheckpoint = { room: store.room, target: mark, base: saved ? String(saved.mark) : null, append: Boolean(append), after: position, count: readCount + rows.length }
              this.db.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)').run(checkpointKey, JSON.stringify(nextCheckpoint))
              this.db.exec('COMMIT')
            } catch (error) { this.db.exec('ROLLBACK'); throw error }
            const next = Math.max(...rows.map(row => Number(row.id)))
            if (next <= after) throw new Error('消息读取没有前进')
            after = next; readCount += rows.length
            await yieldWork()
            if (source.excluded?.(store.room)) { this.exclude([store.room]); continue storeLoop }
          }
          if (this.paused) break
          if (readCount !== mark.count - (append ? previous!.count : 0)) throw new Error('消息数量变化，稍后重试')
          if (!same(mark, source.watermark(store, mark.maxId))) throw new Error('该会话正在变化，稍后继续更新')
          this.db.exec('BEGIN IMMEDIATE')
          try {
            if (!append) this.db.prepare('DELETE FROM messages WHERE source=?').run(store.id)
            this.db.prepare('INSERT OR REPLACE INTO messages SELECT * FROM staging WHERE source=?').run(store.id)
            this.db.prepare('INSERT OR REPLACE INTO stores VALUES (?, ?, ?)').run(store.id, store.room, JSON.stringify(mark))
            if (!append) this.db.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)').run(`audit:${store.id}`, String(Date.now()))
            this.db.prepare('DELETE FROM staging WHERE source=?').run(store.id)
            this.db.prepare('DELETE FROM metadata WHERE key=?').run(checkpointKey)
            this.db.exec('COMMIT')
          } catch (error) { this.db.exec('ROLLBACK'); throw error }
        } catch (error) { status.errors.push(`${store.room}: ${error instanceof Error ? error.message : String(error)}`) }
        status.completedStores++
        this.save(status)
        await yieldWork()
      }
      if (!this.paused) {
        // Remove vanished stores only after successful discovery; never prune on a partial/failed pass.
        if (!status.errors.length) {
          const live = new Set(stores.map(store => store.id))
          this.db.exec('BEGIN IMMEDIATE')
          try {
            for (const row of this.db.prepare('SELECT id FROM stores').all()) if (!live.has(String(row.id))) {
              this.db.prepare('DELETE FROM messages WHERE source=?').run(String(row.id))
              this.db.prepare('DELETE FROM stores WHERE id=?').run(String(row.id))
            }
            this.db.exec('COMMIT')
          } catch (error) { this.db.exec('ROLLBACK'); throw error }
        }
        if (!status.errors.length && sourceVersion !== undefined && source.fingerprint?.() === sourceVersion) this.db.prepare("INSERT OR REPLACE INTO metadata VALUES ('source-fingerprint', ?)").run(sourceVersion)
        else this.db.prepare("DELETE FROM metadata WHERE key='source-fingerprint'").run()
        status.state = status.errors.length ? 'error' : 'ready'
        if (!status.errors.length) status.updatedAt = new Date().toISOString()
      } else status.state = 'paused'
    } catch (error) { status.state = 'error'; status.errors.push(error instanceof Error ? error.message : String(error)) }
    status.current = ''
    this.save(status)
    return this.status()
  }
  isFresh(fingerprint: string): boolean {
    const version = this.db.prepare("SELECT value FROM metadata WHERE key='source-fingerprint'").get()
    const saved = this.db.prepare("SELECT value FROM metadata WHERE key='status'").get()
    return version?.value === fingerprint && !!saved && JSON.parse(String(saved.value)).state === 'ready'
  }
  hasConversation(room: string): boolean {
    const row = this.db.prepare('SELECT COUNT(*) AS planned, COUNT(s.id) AS done FROM planned p LEFT JOIN stores s ON s.id=p.id AND s.room=p.room WHERE p.room=?').get(room)!
    return Number(row.planned) > 0 && row.planned === row.done
  }
  revision(room: string): string {
    const stores = this.db.prepare('SELECT id,mark FROM stores WHERE room=? ORDER BY id').all(room)
    return createHash('sha256').update(JSON.stringify(stores)).digest('hex')
  }
  reportMetadata(room: string, start = 0, end = 253402300800000): { id: string; time: number; sender: string; type: number }[] {
    return this.db.prepare('SELECT id,time,sender,type FROM messages INDEXED BY chat_report_metadata WHERE room=? AND time>=? AND time<? ORDER BY time,id').all(room,start,end)
      .map(row => ({ id: String(row.id), time: Number(row.time), sender: String(row.sender), type: Number(row.type) }))
  }
  summary(room: string): ConversationIndexSummary {
    const row = this.db.prepare('SELECT COUNT(*) AS total, MIN(time) AS firstAt, MAX(time) AS lastAt FROM messages WHERE room=?').get(room)!
    return { total: Number(row.total), firstAt: row.firstAt === null ? null : Number(row.firstAt), lastAt: row.lastAt === null ? null : Number(row.lastAt) }
  }
  speech(room: string, start: number, end: number): SpeechStatsResult {
    const members = this.db.prepare('SELECT sender AS id, COUNT(*) AS count FROM messages WHERE room=? AND time>=? AND time<? AND type NOT IN (10000,10002) GROUP BY sender ORDER BY count DESC, sender').all(room, start, end).map(row => ({ id: String(row.id), name: String(row.id) || '未知成员', count: Number(row.count) }))
    return { members, total: members.reduce((sum, row) => sum + row.count, 0), silentMembers: null }
  }
  reportSelection(room: string, start = 0, end = 253402300800000) {
    this.db.exec('BEGIN')
    try {
      const rows = this.db.prepare(`SELECT date(time / 1000, 'unixepoch', 'localtime') AS day, sender, type, COUNT(*) AS count
        FROM messages INDEXED BY chat_report_metadata WHERE room=? AND time>=? AND time<? GROUP BY day,sender,type ORDER BY day,sender,type`).all(room,start,end)
      const result = { revision: this.revision(room), rows: rows.map(row => ({ id: `${row.day}:${row.sender}:${row.type}`, time: new Date(`${row.day}T00:00:00`).getTime(), sender: String(row.sender), type: Number(row.type), count: Number(row.count) })) }
      this.db.exec('COMMIT')
      return result
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  reportContent(room: string, start: number, end: number, types: ReportContentType[], expectedRevision?: string) {
    this.db.exec('BEGIN')
    try {
      if (expectedRevision && expectedRevision !== this.revision(room)) throw new Error('会话索引已更新，请重新选择会话后生成报告')
      const counts: Record<ReportContentType, number> = { message: 0, voice: 0, image: 0, video: 0 }
      for (const row of this.db.prepare('SELECT type, COUNT(*) AS count FROM messages WHERE room=? AND time>=? AND time<? GROUP BY type').all(room,start,end)) {
        const type = Number(row.type)
        counts[type === 3 ? 'image' : type === 34 ? 'voice' : type === 43 ? 'video' : 'message'] += Number(row.count)
      }
      const result = { counts, rows: this.reportMessages(room, start, end, types) }
      this.db.exec('COMMIT')
      return result
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  selectedReportMessages(room: string, items: { id: string; createdAt: number }[]): WcdbMessage[] {
    const query = this.db.prepare('SELECT source,id,payload FROM messages WHERE room=? AND time=? AND id=?')
    const parents = new Map(items.map(item => [JSON.stringify([item.createdAt, item.id]), item]))
    return [...parents.values()].flatMap(item => query.all(room, item.createdAt, item.id).map(row => this.unseal(row)))
  }
  reportMessages(room: string, start: number, end: number, types: ReportContentType[]): WcdbMessage[] {
    const clauses: string[] = []
    if (types.includes('message')) clauses.push('type NOT IN (3,34,43)')
    if (types.includes('voice')) clauses.push('type=34')
    if (types.includes('image')) clauses.push('type=3')
    if (types.includes('video')) clauses.push('type=43')
    if (!clauses.length) return []
    const rows = this.db.prepare(`SELECT source,id,payload FROM messages WHERE room=? AND time>=? AND time<? AND (${clauses.join(' OR ')}) ORDER BY time,id`).all(room,start,end)
    return rows.map(row => this.unseal(row))
  }
  messages(room: string, start = 0, end = 253402300800000, limit?: number): WcdbMessage[] {
    const rows = limit === undefined
      ? this.db.prepare('SELECT source,id,payload FROM messages WHERE room=? AND time>=? AND time<? ORDER BY time,id').all(room,start,end)
      : this.db.prepare('SELECT source,id,payload FROM messages WHERE room=? AND time>=? AND time<? ORDER BY time DESC,id DESC LIMIT ?').all(room,start,end,limit).reverse()
    return rows.map(row => this.unseal(row))
  }
}
