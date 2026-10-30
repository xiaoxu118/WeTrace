import type { ReportMessagesResult } from '../shared/types'

// Small LRU in the reading process. Reuse only when database metadata is unchanged.
export class ReportRecordCache {
  private entries = new Map<string, { fingerprint: string; data: ReportMessagesResult; bytes: number }>()
  private bytes = 0
  private readonly maxBytes: number
  constructor(maxBytes = 64 * 1024 * 1024) { this.maxBytes = maxBytes }

  get(key: string, fingerprint: () => string, read: () => ReportMessagesResult): ReportMessagesResult {
    const before = fingerprint()
    const cached = this.entries.get(key)
    if (cached?.fingerprint === before) {
      this.entries.delete(key)
      this.entries.set(key, cached)
      return cached.data
    }
    if (cached) { this.bytes -= cached.bytes; this.entries.delete(key) }
    const data = read()
    const after = fingerprint()
    const bytes = data.messages.reduce((total, message) => total + 512 + 2 * (message.text.length + (message.reportMedia?.content.length || 0) + (message.quote?.text.length || 0)), 0)
    if (before !== after || bytes > this.maxBytes) return data
    this.entries.set(key, { fingerprint: after, data, bytes })
    this.bytes += bytes
    while (this.entries.size > 3 || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value!
      this.bytes -= this.entries.get(oldest)!.bytes
      this.entries.delete(oldest)
    }
    return data
  }
}
