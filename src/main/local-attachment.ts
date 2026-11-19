import { isCompleteMp4 } from './local-video.ts'
import fs from 'node:fs'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { imageMime } from './image-decryption.ts'
import type { SyncMessage } from '../shared/types'

/** Copy verified file attachments, which use appmsg type 6 even when the content is a PNG. */
export function readLocalAttachment(root: string, room: string, file: NonNullable<SyncMessage['file']>, directories?: Map<string, Dirent[]>): { data: Buffer; mime: string } | undefined {
  if (!file.name || /[/\\\0]/.test(file.name) || ['.', '..'].includes(file.name)) return undefined
  const hash = file.md5 && /^[a-f\d]{32}$/i.test(file.md5) ? file.md5.toLowerCase() : undefined
  if (!hash && !file.size) return undefined
  const scoped = path.join(root, 'msg/attach', createHash('md5').update(room).digest('hex'))
  // Global attachment folders require a content hash; identical filenames are not identities.
  const roots = [scoped, ...(hash ? [path.join(root, 'msg/file'), path.join(root, 'FileStorage/File')] : [])]
  const candidates = new Map<string, { file: string; size: number }>()
  let visited = 0
  function visit(directory: string, depth: number): void {
    if (depth > 5 || ++visited > 10000) return
    try {
      const entries = directories?.get(directory) ?? fs.readdirSync(directory, { withFileTypes: true })
      directories?.set(directory, entries)
      for (const entry of entries) {
        if (entry.isDirectory()) { visit(path.join(directory, entry.name), depth + 1); continue }
        if (!entry.isFile()) continue
        const name = entry.name.toLowerCase()
        if (name !== file.name.toLowerCase() && !(hash && (name === hash || name.startsWith(hash + '.') || name.startsWith(hash + '_')))) continue
        const candidate = path.join(directory, entry.name), info = fs.lstatSync(candidate)
        if (!info.isFile() || info.size > 256 * 1024 * 1024 || file.size !== undefined && info.size !== file.size) continue
        candidates.set(candidate, { file: candidate, size: info.size })
      }
    } catch { /* A file can disappear or still be downloading. */ }
  }
  for (const directory of roots) visit(directory, 0)
  // Without a digest, do not select one of multiple same-name copies.
  if (!hash && candidates.size !== 1) return undefined
  for (const candidate of candidates.values()) {
    try {
      const data = fs.readFileSync(candidate.file)
      if (data.length !== candidate.size || hash && createHash('md5').update(data).digest('hex') !== hash) continue
      return { data, mime: imageMime(data) || (isCompleteMp4(data) ? 'video/mp4' : 'application/octet-stream') }
    } catch { /* Preserve the previous successful capture if this read fails. */ }
  }
  return undefined
}
