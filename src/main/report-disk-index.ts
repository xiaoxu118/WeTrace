import { DatabaseSync } from 'node:sqlite'
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import type { ReportMessagesResult, SyncMessage } from '../shared/types'

// Persist report records encrypted; only time/type/position are indexed in plaintext.
export class ReportDiskIndex {
  private readonly directory: string
  constructor(directory: string) { this.directory = directory }

  exclude(account: string, secret: string, rooms: string[]): void {
    const identity = createHash('sha256').update(JSON.stringify([account, secret])).digest('hex')
    const file = path.join(this.directory, `${identity}.sqlite`)
    if (!existsSync(file) || !rooms.length) return
    const key = Buffer.from(hkdfSync('sha256', secret, identity, 'wetrace-report-index-v1', 32))
    const db = this.open(file)
    try {
      db.exec('BEGIN IMMEDIATE')
      for (const row of db.prepare('SELECT id,metadata FROM entries').all()) {
        const metadata = this.unseal<{ data: { conversationId: string } }>(row.metadata, key, `${row.id}:metadata`)
        if (!rooms.includes(metadata.data.conversationId)) continue
        db.prepare('DELETE FROM messages WHERE entry=?').run(String(row.id))
        db.prepare('DELETE FROM entries WHERE id=?').run(String(row.id))
      }
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    finally { db.close() }
  }

  get(account: string, secret: string, entry: string, fingerprint: () => string, read: () => ReportMessagesResult): ReportMessagesResult {
    const before = fingerprint()
    const identity = createHash('sha256').update(JSON.stringify([account, secret])).digest('hex')
    const key = Buffer.from(hkdfSync('sha256', secret, identity, 'wetrace-report-index-v1', 32))
    const file = path.join(this.directory, `${identity}.sqlite`)
    const cached = this.load(file, entry, before, key)
    if (cached && fingerprint() === before) return cached
    const data = read()
    if (fingerprint() === before) this.save(file, entry, before, key, data)
    return data
  }

  private open(file: string): DatabaseSync {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const db = new DatabaseSync(file)
    try {
      chmodSync(file, 0o600)
      db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, metadata BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS messages (entry TEXT NOT NULL, position INTEGER NOT NULL, time INTEGER NOT NULL, type INTEGER NOT NULL, payload BLOB NOT NULL, PRIMARY KEY(entry, position));
        CREATE INDEX IF NOT EXISTS report_entry_time_type ON messages(entry, time, type);`)
      return db
    } catch (error) { db.close(); throw error }
  }

  private seal(value: unknown, key: Buffer, context: string): Buffer {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    cipher.setAAD(Buffer.from(context))
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted])
  }

  private unseal<T>(value: unknown, key: Buffer, context: string): T {
    const bytes = Buffer.from(value as Uint8Array)
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
    cipher.setAuthTag(bytes.subarray(12, 28))
    cipher.setAAD(Buffer.from(context))
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')) as T
  }

  private load(file: string, entry: string, fingerprint: string, key: Buffer): ReportMessagesResult | undefined {
    let db: DatabaseSync | undefined
    try {
      db = this.open(file)
      const row = db.prepare('SELECT fingerprint, metadata FROM entries WHERE id = ?').get(entry)
      if (row?.fingerprint !== fingerprint) return undefined
      const metadata = this.unseal<{ version: number; count: number; data: Omit<ReportMessagesResult, 'messages'> }>(row.metadata, key, `${entry}:metadata`)
      if (metadata.version !== 1) return undefined
      const rows = db.prepare('SELECT position, payload FROM messages WHERE entry = ? ORDER BY position').all(entry)
      if (rows.length !== metadata.count) return undefined
      const messages = rows.map(row => this.unseal<SyncMessage>(row.payload, key, `${entry}:${row.position}`))
      return { ...metadata.data, messages }
    } catch { return undefined }
    finally { db?.close() }
  }

  private save(file: string, entry: string, fingerprint: string, key: Buffer, data: ReportMessagesResult): void {
    let db: DatabaseSync | undefined
    try {
      db = this.open(file)
      db.exec('BEGIN IMMEDIATE')
      db.prepare('DELETE FROM messages WHERE entry = ?').run(entry)
      const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)')
      data.messages.forEach((message, index) => insert.run(entry, index, message.createdAt, message.messageType, this.seal(message, key, `${entry}:${index}`)))
      const { messages, ...metadata } = data
      db.prepare('INSERT OR REPLACE INTO entries VALUES (?, ?, ?)').run(entry, fingerprint, this.seal({ version: 1, count: messages.length, data: metadata }, key, `${entry}:metadata`))
      db.exec('COMMIT')
    } catch {
      try { db?.exec('ROLLBACK') } catch { /* No transaction was started. */ }
      // A cache failure must not discard successfully read records.
    } finally { db?.close() }
  }
}
