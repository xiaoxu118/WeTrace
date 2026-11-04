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
  async get(key: string, revision: () => string, read: () => Promise<T>, signal?: AbortSignal, allowed: () => boolean = () => true): Promise<{ data: T; cached: boolean }> {
    signal?.throwIfAborted()
    if (!allowed()) { this.remove(key); return { data: await read(), cached: false } }
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
    if (allowed() && before === after && bytes <= this.maxBytes) {
      // Another chat may have populated this key while the asynchronous read was running.
      this.remove(key)
      this.entries.set(key, { revision: after, data, bytes, expires: Date.now() + this.ttlMs }); this.bytes += bytes
      while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) this.remove(this.entries.keys().next().value!)
    }
    return { data, cached: false }
  }
  clear(): void { this.entries.clear(); this.bytes = 0 }
  private remove(key: string): void {
    const entry = this.entries.get(key)
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(key) }
  }
}
