import type { ConversationIndexSummary, SpeechStatsResult } from '../shared/types'

export interface MessageStore { tableName: string; dbPath: string }
type Row = Record<string, unknown>
type Query = (store: MessageStore, sql: string) => Row[]
const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`

// Run aggregation in the source database. No message bodies, OFFSET paging or derived rebuilds.
export function aggregateMessageStores(stores: MessageStore[], query: Query, range?: { start: number; end: number; selfId: string }): ConversationIndexSummary | SpeechStatsResult {
  let total = 0, firstAt: number | null = null, lastAt: number | null = null
  const members = new Map<string, { id: string; name: string; count: number }>()
  for (const store of stores) {
    const columns = new Set(query(store, `PRAGMA table_info(${quote(store.tableName)})`).map(row => String(row.name)))
    const column = (names: string[]): string | undefined => names.find(name => columns.has(name))
    const time = column(['create_time', 'createTime', 'msg_create_time'])
    if (!time) throw new Error('消息表缺少时间字段，无法进行轻量统计')
    const table = quote(store.tableName)
    if (!range) {
      const row = query(store, `SELECT COUNT(*) AS total, MIN(${quote(time)}) AS firstAt, MAX(${quote(time)}) AS lastAt FROM ${table}`)[0]
      total += Number(row?.total ?? 0)
      const first = row?.firstAt == null ? null : Number(row.firstAt) * 1000
      const last = row?.lastAt == null ? null : Number(row.lastAt) * 1000
      if (first !== null) firstAt = firstAt === null ? first : Math.min(firstAt, first)
      if (last !== null) lastAt = lastAt === null ? last : Math.max(lastAt, last)
      continue
    }
    const type = column(['local_type', 'localType', 'message_type', 'messageType', 'msg_type', 'type'])
    if (!type) throw new Error('消息表缺少类型字段，无法进行轻量统计')
    let join = ''
    const explicitSender = column(['sender_username', 'senderUsername', 'from_username'])
    let sender = explicitSender ? `m.${quote(explicitSender)}` : ''
    if (!sender && columns.has('real_sender_id')) {
      const namesTable = query(store, "SELECT name FROM sqlite_master WHERE type='table' AND lower(name) LIKE 'name2id%' ORDER BY name").map(row => String(row.name))[0]
      if (!namesTable) throw new Error('消息表缺少发言人映射，无法进行轻量统计')
      const nameColumns = new Set(query(store, `PRAGMA table_info(${quote(namesTable)})`).map(row => String(row.name)))
      const nameColumn = ['user_name', 'username', 'userName'].find(name => nameColumns.has(name))
      if (!nameColumn) throw new Error('发言人映射格式不支持')
      join = ` LEFT JOIN ${quote(namesTable)} AS n ON n.rowid = m.real_sender_id`
      sender = `n.${quote(nameColumn)}`
    }
    if (!sender) throw new Error('消息表缺少发言人字段，无法进行轻量统计')
    const sent = column(['is_send', 'isSend', 'computed_is_send'])
    const self = `'${range.selfId.replaceAll("'", "''")}'`
    sender = sent ? `CASE WHEN m.${quote(sent)} <> 0 THEN ${self} ELSE COALESCE(${sender}, '') END` : `COALESCE(${sender}, '')`
    // Source WCDB timestamps are seconds. Front-end windows are half-open milliseconds.
    const rows = query(store, `SELECT ${sender} AS sender, COUNT(*) AS count FROM ${table} AS m${join}
      WHERE m.${quote(time)} >= ${Math.ceil(range.start / 1000)} AND m.${quote(time)} < ${Math.ceil(range.end / 1000)}
      AND (m.${quote(type)} & 65535) NOT IN (10000, 10002) GROUP BY ${sender}`)
    for (const row of rows) {
      const id = String(row.sender ?? '')
      const member = members.get(id) ?? { id, name: id || '未知成员', count: 0 }
      member.count += Number(row.count)
      members.set(id, member)
    }
  }
  if (!range) return { total, firstAt, lastAt }
  const ranked = [...members.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
  return { members: ranked, silentMembers: null, total: ranked.reduce((sum, member) => sum + member.count, 0) }
}
