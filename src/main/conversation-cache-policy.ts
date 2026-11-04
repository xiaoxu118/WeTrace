import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

let directory = ''
export function configureConversationCachePolicy(path: string): void { directory = path }
function file(root: string): string {
  if (!directory) throw new Error('缓存排除名单尚未初始化')
  return join(directory, `${createHash('sha256').update(root).digest('hex')}.json`)
}
export function excludedConversations(root: string): string[] {
  try {
    const rooms: unknown = JSON.parse(readFileSync(file(root), 'utf8'))
    if (!Array.isArray(rooms) || rooms.some(room => typeof room !== 'string' || !room.endsWith('@chatroom'))) throw new Error('缓存排除名单损坏，请检查本地配置')
    return rooms as string[]
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}
export function conversationCacheAllowed(root: string, room: string): boolean { return !excludedConversations(root).includes(room) }
export function saveExcludedConversations(root: string, rooms: unknown): string[] {
  if (!Array.isArray(rooms) || rooms.length > 10000 || rooms.some(room => typeof room !== 'string' || !room.endsWith('@chatroom') || room.length > 512)) throw new Error('群聊排除名单无效')
  const values = [...new Set(rooms as string[])].sort()
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const target = file(root), temporary = `${target}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(values), { mode: 0o600 })
  renameSync(temporary, target)
  return values
}
