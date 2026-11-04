import { conversationCacheAllowed } from './conversation-cache-policy.ts'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

interface CachedTranscription { text: string; fromCache: boolean; warning?: string }
interface CacheEntry { schema: number; key: string; text: string; createdAt: string }

// Bump when decoding, language selection, or text normalization changes.
const PIPELINE_VERSION = 'silk-16000-sensevoice-auto-itn-v1'

export class VoiceTranscriptionCache {
  private readonly directory: string
  private pending = new Map<string, Promise<CachedTranscription>>()
  private recent = new Map<string, CachedTranscription>()

  constructor(directory: string) { this.directory = directory }

  async getOrTranscribe(scope: string, hex: string, modelVersion: string, transcribe: () => Promise<string>): Promise<CachedTranscription> {
    if (!hex || hex.length % 2 || !/^[a-f\d]+$/i.test(hex)) throw new Error('语音数据格式无效')
    let ids: unknown
    try { ids = JSON.parse(scope) } catch { /* Legacy opaque scopes. */ }
    const allowed = () => !Array.isArray(ids) || ids.length !== 2 || !ids.every(id => typeof id === 'string') || conversationCacheAllowed(ids[0], ids[1])
    if (!allowed()) return { text: (await transcribe()).trim(), fromCache: false }
    const key = createHash('sha256').update(JSON.stringify([scope, modelVersion, PIPELINE_VERSION])).update(Buffer.from(hex, 'hex')).digest('hex')
    const recent = this.recent.get(key)
    if (recent) return { ...recent, fromCache: true }
    const running = this.pending.get(key)
    if (running) return { ...await running, fromCache: true }
    const task = this.loadOrCreate(key, transcribe, allowed)
    this.pending.set(key, task)
    try {
      const result = await task
      if (allowed()) this.recent.set(key, result)
      if (this.recent.size > 128) this.recent.delete(this.recent.keys().next().value!)
      return result
    } finally { this.pending.delete(key) }
  }

  private async loadOrCreate(key: string, transcribe: () => Promise<string>, allowed: () => boolean): Promise<CachedTranscription> {
    const file = path.join(this.directory, `${key}.json`)
    try {
      if ((await fs.stat(file)).size <= 1024 * 1024) {
        const entry = JSON.parse(await fs.readFile(file, 'utf8')) as CacheEntry
        if (entry.schema === 1 && entry.key === key && typeof entry.text === 'string' && entry.text.trim()) return { text: entry.text, fromCache: true }
      }
    } catch { /* Missing or damaged cache entries are rebuilt from local audio. */ }
    const text = (await transcribe()).trim()
    if (!text) throw new Error('未识别到有效语音')
    if (!allowed()) return { text, fromCache: false }
    // Commit every successful transcription immediately, independently of report generation.
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
      await fs.writeFile(temporary, JSON.stringify({ schema: 1, key, text, createdAt: new Date().toISOString() } satisfies CacheEntry), { mode: 0o600 })
      if (!allowed()) { await fs.rm(temporary, { force: true }); return { text, fromCache: false } }
      await fs.rename(temporary, file)
      return { text, fromCache: false }
    } catch {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      return { text, fromCache: false, warning: '语音已识别，但本地缓存写入失败；本次应用会话仍可复用，重启后可能需要重新识别' }
    }
  }
}
