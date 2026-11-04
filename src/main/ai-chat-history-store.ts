import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AiChatArchive, LoadAiChatHistoryInput, SaveAiChatHistoryInput } from '../shared/ai-chat-history'

interface Envelope { schema: 1; revision: number; archive: AiChatArchive }
function validateArchive(value: AiChatArchive): AiChatArchive {
  if (!value || !Array.isArray(value.chats) || (value.activeId !== null && typeof value.activeId !== 'string')) throw new Error('对话历史格式无效')
  const ids = new Set<string>()
  for (const chat of value.chats) {
    if (!chat || typeof chat.id !== 'string' || !chat.id || ids.has(chat.id) || typeof chat.title !== 'string' || !Number.isFinite(chat.updatedAt) || !Array.isArray(chat.turns)
      || chat.turns.some(turn => !turn || !['user', 'assistant'].includes(turn.role) || typeof turn.content !== 'string')
      || (chat.context !== undefined && (!chat.context || typeof chat.context.conversationId !== 'string' || typeof chat.context.conversationName !== 'string'))
      || (chat.memory !== undefined && (!chat.memory || chat.memory.version !== 1 || typeof chat.memory.summary !== 'string' || typeof chat.memory.scope !== 'string' || !Number.isInteger(chat.memory.coveredTurns) || chat.memory.coveredTurns < 0 || typeof chat.memory.prefixHash !== 'string'))) throw new Error('对话历史格式无效，未覆盖已保存数据')
    ids.add(chat.id)
  }
  if (value.activeId && !ids.has(value.activeId)) return { ...value, activeId: null }
  return value
}

/** Account-isolated durable history. The directory is outside both the app bundle and caches. */
export class AiChatHistoryStore {
  private queues = new Map<string, Promise<unknown>>()
  private directory: string
  constructor(directory: string) { this.directory = directory }
  private filename(root: string): string {
    if (typeof root !== 'string' || !root.trim()) throw new Error('请先连接微信账号再读取对话历史')
    return path.join(this.directory, `${createHash('sha256').update(root).digest('hex')}.json`)
  }
  private async exclusive<T>(file: string, run: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(file) ?? Promise.resolve()
    const task = previous.catch(() => undefined).then(run)
    this.queues.set(file, task)
    try { return await task } finally { if (this.queues.get(file) === task) this.queues.delete(file) }
  }
  private async read(file: string): Promise<Envelope | undefined> {
    let missing = true
    for (const candidate of [file, `${file}.bak`]) {
      try {
        const value = JSON.parse(await fs.readFile(candidate, 'utf8')) as Envelope
        if (value.schema !== 1 || !Number.isInteger(value.revision) || value.revision < 1) throw new Error('invalid history')
        return { ...value, archive: validateArchive(value.archive) }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') missing = false }
    }
    if (!missing) throw new Error('本地对话文件和备份无法读取，已保留原文件；请勿清理应用数据')
    return undefined
  }
  private async atomicWrite(file: string, value: Envelope): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      const handle = await fs.open(temporary, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
      await fs.rename(temporary, file)
    } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
  }
  private async commit(file: string, archive: AiChatArchive, previous?: Envelope): Promise<Envelope> {
    const value: Envelope = { schema: 1, revision: (previous?.revision ?? 0) + 1, archive }
    // Copy the last valid envelope, never a damaged primary, into the recovery file.
    if (previous) await this.atomicWrite(`${file}.bak`, previous)
    await this.atomicWrite(file, value)
    return value
  }
  async flush(): Promise<void> { await Promise.allSettled([...this.queues.values()]) }
  async load(input: LoadAiChatHistoryInput): Promise<Envelope> {
    const file = this.filename(input.root)
    return this.exclusive(file, async () => {
      const stored = await this.read(file)
      if (stored) return stored
      // Import only when durable history does not exist; deleted chats must not reappear on reload.
      const archive = validateArchive(input.legacy ?? { chats: [], activeId: null })
      return this.commit(file, archive)
    })
  }
  async save(input: SaveAiChatHistoryInput): Promise<number> {
    const file = this.filename(input.root)
    const archive = validateArchive(input.archive)
    return this.exclusive(file, async () => {
      const previous = await this.read(file)
      if (input.revision !== (previous?.revision ?? 0)) throw new Error('对话历史已在其他窗口更新，未覆盖本地文件；请重新打开应用后再修改')
      return (await this.commit(file, archive, previous)).revision
    })
  }
}
