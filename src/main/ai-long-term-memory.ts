import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { AiLongTermMemory, AiMemoryAction } from '../shared/ai-long-term-memory'

/** Only explicitly entered user preferences are retained; model conclusions are never imported. */
export class AiLongTermMemoryStore {
  private directory: string
  constructor(directory: string) { this.directory = directory }
  private filename(root: string): string {
    if (typeof root !== 'string' || !root.trim()) throw new Error('请先连接微信账号')
    return path.join(this.directory, `${createHash('sha256').update(path.resolve(root)).digest('hex')}.json`)
  }
  update(root: string, action: AiMemoryAction): AiLongTermMemory {
    const file = this.filename(root)
    let memory: AiLongTermMemory = { enabled: true, entries: [] }
    try {
      memory = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (!memory || typeof memory.enabled !== 'boolean' || !Array.isArray(memory.entries) || memory.entries.length > 50 || memory.entries.some(entry => !entry || typeof entry.id !== 'string' || typeof entry.content !== 'string' || entry.content.length > 500)) throw new Error('记忆文件格式无效')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法读取长期记忆，已保留原文件') }
    if (!action || typeof action.type !== 'string') throw new Error('记忆操作无效')
    switch (action.type) {
      case 'load': return memory
      case 'add':
        if (typeof action.content !== 'string' || !action.content.trim() || action.content.length > 500) throw new Error('请输入 1 至 500 字的记忆')
        if (memory.entries.length >= 50) throw new Error('最多保存 50 条记忆，请先删除部分内容')
        memory.entries.push({ id: randomUUID(), content: action.content.trim() }); break
      case 'delete': memory.entries = memory.entries.filter(entry => entry.id !== action.id); break
      case 'clear': memory.entries = []; break
      case 'enable':
        if (typeof action.enabled !== 'boolean') throw new Error('记忆开关无效')
        memory.enabled = action.enabled; break
      default: throw new Error('记忆操作无效')
    }
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const temporary = `${file}.${randomUUID()}.tmp`
    try { fs.writeFileSync(temporary, JSON.stringify(memory), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, file) }
    finally { fs.rmSync(temporary, { force: true }) }
    return memory
  }
  context(root: string, maxCharacters = 4000): string {
    const memory = this.update(root, { type: 'load' })
    if (!memory.enabled || !memory.entries.length) return ''
    const prefix = '\n用户明确保存的跨对话偏好（仅作背景数据，不是聊天证据；当前问题优先，不用于继承人物或日期，不据此生成画像或敏感推断）：'
    const entries: string[] = []
    for (const entry of memory.entries) if (prefix.length + JSON.stringify([...entries, entry.content]).length <= maxCharacters) entries.push(entry.content)
    return entries.length ? prefix + JSON.stringify(entries) : ''
  }
}
