import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { reportDateTimestamp } from '../shared/report-messages.ts'
import type { ConversationIndexSummary, SpeechStatsQuery, SpeechStatsResult } from '../shared/types'
import type { WcdbMessage } from './wcdb4-client'

export function sourceFingerprint(root: string): string {
  const entries: string[] = []
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (/\.db(?:-wal)?$/.test(entry.name)) {
        const stat = statSync(file)
        entries.push(`${file}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`)
      }
    }
  }
  visit(join(root, 'db_storage'))
  return createHash('sha256').update(entries.join('\n')).digest('hex')
}

// Only statistical metadata is persisted; message bodies and media never enter this index.
function withConversationIndex<T>(directory: string, accountId: string, conversationId: string, fingerprint: () => string, read: (limit: number, offset: number) => WcdbMessage[], selfId: string, select: (db: DatabaseSync) => T): T {
  if (!conversationId?.trim()) throw new Error('请选择会话')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(join(directory, `${createHash('sha256').update(accountId).digest('hex')}.sqlite`))
  try {
    db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS speech (room TEXT NOT NULL, sender TEXT NOT NULL, time INTEGER NOT NULL, type INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS speech_room_time ON speech(room, time);
      CREATE TABLE IF NOT EXISTS sources (room TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);`)
    const before = fingerprint()
    const cached = db.prepare('SELECT fingerprint FROM sources WHERE room = ?').get(conversationId)
    if (cached?.fingerprint !== before) {
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('DELETE FROM speech WHERE room = ?').run(conversationId)
        const insert = db.prepare('INSERT INTO speech VALUES (?, ?, ?, ?)')
        const pageSize = 2000
        for (let offset = 0; ; offset += pageSize) {
          const rows = read(pageSize, offset)
          for (const row of rows) {
            const sender = row.isSend || row.sender === selfId ? selfId : row.sender || ''
            insert.run(conversationId, sender, row.createTime * 1000, row.type)
          }
          if (rows.length < pageSize) break
        }
        // A changing source must not be recorded as an up-to-date snapshot.
        const after = fingerprint()
        if (before !== after) throw new Error('聊天记录正在更新，请稍后重试')
        db.prepare('INSERT OR REPLACE INTO sources VALUES (?, ?)').run(conversationId, before)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
    }
    return select(db)
  } finally { db.close() }
}

export function querySpeechIndex(directory: string, accountId: string, query: SpeechStatsQuery, fingerprint: () => string, read: (limit: number, offset: number) => WcdbMessage[], selfId: string): SpeechStatsResult {
  if (!query.conversationId?.endsWith('@chatroom')) throw new Error('请选择群聊')
  const start = query.startDate ? reportDateTimestamp(query.startDate) : 0
  const end = query.endDate ? reportDateTimestamp(query.endDate, true) : 253402300800000
  if (start >= end) throw new Error('开始日期不能晚于结束日期')
  return withConversationIndex(directory, accountId, query.conversationId, fingerprint, read, selfId, db => {
    const members = db.prepare(`SELECT sender, COUNT(*) AS count FROM speech
      WHERE room = ? AND time >= ? AND time < ? AND type NOT IN (10000, 10002)
      GROUP BY sender ORDER BY count DESC, sender`).all(query.conversationId, start, end)
      .map(row => ({ id: String(row.sender), name: String(row.sender) || '未知成员', count: Number(row.count) }))
    return { members, silentMembers: null, total: members.reduce((sum, member) => sum + member.count, 0) }
  })
}

export function queryConversationIndexSummary(directory: string, accountId: string, conversationId: string, fingerprint: () => string, read: (limit: number, offset: number) => WcdbMessage[], selfId: string): ConversationIndexSummary {
  return withConversationIndex(directory, accountId, conversationId, fingerprint, read, selfId, db => {
    const row = db.prepare('SELECT COUNT(*) AS total, MIN(time) AS firstAt, MAX(time) AS lastAt FROM speech WHERE room = ?').get(conversationId)!
    return { total: Number(row.total), firstAt: row.firstAt === null ? null : Number(row.firstAt), lastAt: row.lastAt === null ? null : Number(row.lastAt) }
  })
}
