import { createHash } from 'node:crypto'
import type { WcdbMessage } from './wcdb4-client'
import type { SyncMessage } from '../shared/types'
type Presented = Pick<SyncMessage, 'text' | 'image' | 'video' | 'file' | 'voice' | 'sticker' | 'link' | 'quote' | 'forwarded' | 'revoke'>

/** Avoid decoding the same archived media on every WAL notification. */
export class SyncPresentationCache {
  private entries = new Map<string, { root: string; roomHash: string; hashes: string[]; kind: string; complete: boolean; expires: number; value: Presented }>()
  read(root: string, key: string, room: string, row: WcdbMessage, load: () => Presented, now = Date.now()): Presented {
    if (![3, 43, 62, 49, 47].includes(row.type >>> 0)) return load()
    const id = createHash('sha256').update(JSON.stringify([root, key, room, row.id, row.createTime, row.type, row.content, row.imageFileHash])).digest('hex')
    const cached = this.entries.get(id)
    if (cached && cached.expires > now) { this.entries.delete(id); this.entries.set(id, cached); return cached.value }
    const value = load()
    const kind = value.image ? 'image' : value.video ? 'video' : value.file ? 'file' : value.sticker ? 'sticker' : 'other'
    const source = value.image?.source || value.video?.source || value.file?.source || value.sticker?.source
    const complete = Boolean(source && !value.image?.thumbnail) || kind === 'other'
    this.entries.set(id, { root, roomHash: createHash('md5').update(room).digest('hex'),
      hashes: [...(value.image?.hashes || []), ...(value.video?.hashes || []), value.file?.md5 || '', value.file?.name || '', value.sticker?.md5 || ''].filter(Boolean).map(value => value.toLowerCase()),
      kind, complete, expires: source || complete ? Infinity : now + 5000, value })
    while (this.entries.size > 30000) this.entries.delete(this.entries.keys().next().value!)
    return value
  }
  invalidate(root: string, changedPath?: string): void {
    const path = changedPath?.replaceAll('\\', '/').toLowerCase()
    for (const [id, entry] of this.entries) {
      if (entry.root !== root || entry.complete) continue
      if (!path || path.includes(entry.roomHash) || entry.hashes.some(hash => path.includes(hash))
        || entry.kind === 'video' && /(?:^|\/)video\//.test(path)
        || entry.kind === 'file' && /(?:^|\/)file\//.test(path)
        || entry.kind === 'image' && /filestorage\/image\//.test(path)) this.entries.delete(id)
    }
  }
  clear(root: string): void { for (const [id, entry] of this.entries) if (entry.root === root) this.entries.delete(id) }
}
