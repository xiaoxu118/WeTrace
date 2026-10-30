import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

interface CachedDescription { text: string; fromCache: boolean; warning?: string }
interface CacheEntry { schema: number; key: string; text: string; createdAt: string }

// Bump when image processing or description policy changes.
const PIPELINE_VERSION = 'image-description-v1'

export class ImageDescriptionCache {
  private readonly directory: string
  private pending = new Map<string, Promise<CachedDescription>>()
  private recent = new Map<string, CachedDescription>()

  constructor(directory: string) { this.directory = directory }

  async getOrDescribe(scope: string, image: { data: Buffer; mime: string }, modelVersion: string, describe: () => Promise<string>): Promise<CachedDescription> {
    if (!image.data.length || !image.mime) throw new Error('图片数据格式无效')
    const key = createHash('sha256').update(JSON.stringify([scope, modelVersion, PIPELINE_VERSION, image.mime])).update(image.data).digest('hex')
    const recent = this.recent.get(key)
    if (recent) return { ...recent, fromCache: true }
    const running = this.pending.get(key)
    if (running) return { ...await running, fromCache: true }
    const task = this.loadOrCreate(key, describe)
    this.pending.set(key, task)
    try {
      const result = await task
      this.recent.set(key, result)
      if (this.recent.size > 128) this.recent.delete(this.recent.keys().next().value!)
      return result
    } finally { this.pending.delete(key) }
  }

  private async loadOrCreate(key: string, describe: () => Promise<string>): Promise<CachedDescription> {
    const file = path.join(this.directory, `${key}.json`)
    try {
      if ((await fs.stat(file)).size <= 1024 * 1024) {
        const entry = JSON.parse(await fs.readFile(file, 'utf8')) as CacheEntry
        if (entry.schema === 1 && entry.key === key && typeof entry.text === 'string' && entry.text.trim()) return { text: entry.text, fromCache: true }
      }
    } catch { /* Missing or damaged cache entries are rebuilt from image data. */ }
    const text = (await describe()).trim()
    if (!text) throw new Error('未识别到有效图片描述')
    // Commit every successful description immediately, independently of report generation.
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
      await fs.writeFile(temporary, JSON.stringify({ schema: 1, key, text, createdAt: new Date().toISOString() } satisfies CacheEntry), { mode: 0o600 })
      await fs.rename(temporary, file)
      return { text, fromCache: false }
    } catch {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      return { text, fromCache: false, warning: '图片已理解，但本地缓存写入失败；本次应用会话仍可复用，重启后可能需要重新理解' }
    }
  }
}
