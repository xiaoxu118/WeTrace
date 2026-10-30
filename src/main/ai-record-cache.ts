/** Bounded process-local cache. A changed source revision invalidates a snapshot. */
export class AiRecordCache<T> {
  private entries = new Map<string, { revision: string; data: T; bytes: number; expires: number }>()
  private bytes = 0
  private maxBytes: number
  private ttlMs: number
  private maxEntries: number
  constructor(maxBytes = 64 * 1024 * 1024, ttlMs = 10 * 60_000, maxEntries = 12) {
    this.maxBytes = maxBytes; this.ttlMs = ttlMs; this.maxEntries = maxEntries
  }
  async get(key: string, revision: () => string, read: () => Promise<T>, signal?: AbortSignal): Promise<{ data: T; cached: boolean }> {
    signal?.throwIfAborted()
    const now = Date.now()
    for (const [id, entry] of this.entries) if (entry.expires <= now) this.remove(id)
    let before: string
    try { before = revision() } catch { return { data: await read(), cached: false } }
    const previous = this.entries.get(key)
    if (previous?.revision === before) {
      this.entries.delete(key); this.entries.set(key, previous)
      return { data: previous.data, cached: true }
    }
    this.remove(key)
    const data = await read()
    signal?.throwIfAborted()
    let after: string
    try { after = revision() } catch { return { data, cached: false } }
    const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8')
    if (before === after && bytes <= this.maxBytes) {
      this.entries.set(key, { revision: after, data, bytes, expires: Date.now() + this.ttlMs }); this.bytes += bytes
      while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) this.remove(this.entries.keys().next().value!)
    }
    return { data, cached: false }
  }
  private remove(key: string): void {
    const entry = this.entries.get(key)
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(key) }
  }
}
