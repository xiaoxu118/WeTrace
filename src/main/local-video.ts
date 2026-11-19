import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Resolve names from message hashes or the native hardlink table; XML paths are never used.
export function videoHashes(xml: string, fileHash?: string): string[] {
  const video = /<videomsg\b[^>]*>/i.exec(xml)?.[0] || ''
  const hashes = [...video.matchAll(/\b(?:md5|rawmd5|newmd5)\s*=\s*["']([a-f\d]{32})["']/gi)].map(match => match[1])
  return [...new Set([...hashes, fileHash || ''].filter(hash => /^[a-f\d]{32}$/i.test(hash)).map(hash => hash.toLowerCase()))]
}

export function readLocalVideo(root: string, room: string, xml: string, fileHash?: string, resolveFilename?: (hash: string) => string | undefined): Buffer | undefined {
  return readLocalVideoHashes(root, room, videoHashes(xml, fileHash), resolveFilename)
}

export function readLocalVideoHashes(root: string, room: string, candidates: string[], resolveFilename?: (hash: string) => string | undefined): Buffer | undefined {
  return inspectLocalVideoHashes(root, room, candidates, resolveFilename).data
}

export type VideoReadFailure = 'no-metadata' | 'not-found' | 'incomplete' | 'unsupported' | 'too-large' | 'read-failed'
export function videoUnavailable(reason: VideoReadFailure): string {
  return { 'no-metadata': '撤回前未保存视频定位信息，无法补取视频', 'not-found': '本机未找到对应视频文件', 'incomplete': '视频文件尚未下载完整或已损坏', 'unsupported': '已找到视频文件，但文件格式暂不支持', 'too-large': '视频超过本地留存大小上限', 'read-failed': '视频文件读取失败，请重试' }[reason]
}
export function inspectLocalVideoHashes(root: string, room: string, candidates: string[], resolveFilename?: (hash: string) => string | undefined): { data?: Buffer; reason?: VideoReadFailure } {
  const hashes = [...new Set(candidates.filter(hash => /^[a-f\d]{32}$/i.test(hash)).map(hash => hash.toLowerCase()))].slice(0, 8)
  if (!hashes.length) return { reason: 'no-metadata' }
  let reason: VideoReadFailure = 'not-found'
  const names = new Set<string>()
  for (const hash of hashes) {
    let resolved: string | undefined
    try { resolved = resolveFilename?.(hash) } catch { /* Optional native mapping. */ }
    // A mapping is a filename, never authority to read arbitrary filesystem paths.
    if (resolved && resolved.length <= 255 && resolved !== '.' && resolved !== '..' && !/[\/\\\0]/.test(resolved)) names.add(resolved)
  }
  for (const hash of hashes) { names.add(hash); names.add(hash.toUpperCase()) }
  const roots = [path.join(root, 'msg/attach', createHash('md5').update(room).digest('hex')), path.join(root, 'msg/video'), path.join(root, 'FileStorage/Video')]
  let visited = 0
  function visit(directory: string, depth: number): Buffer | undefined {
    if (depth > 4 || ++visited > 10000) return undefined
    for (const name of names) for (const extension of ['.mp4', '.dat', '']) {
      const file = path.join(directory, name + extension)
      try {
        const info = fs.lstatSync(file)
        if (!info.isFile()) continue
        if (info.size < 12) { reason = 'incomplete'; continue }
        if (info.size > 256 * 1024 * 1024) { reason = 'too-large'; continue }
        const fd = fs.openSync(file, 'r'), header = Buffer.alloc(12)
        try { fs.readSync(fd, header, 0, header.length, 0) } finally { fs.closeSync(fd) }
        if (header.toString('ascii', 4, 8) === 'ftyp') {
          const data = fs.readFileSync(file)
          if (isCompleteMp4(data)) return data
          reason = 'incomplete'
        } else reason = 'unsupported'
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') reason = 'read-failed' }
    }
    try {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const result = visit(path.join(directory, entry.name), depth + 1)
        if (result) return result
      }
    } catch { /* This WeChat version may use another media directory. */ }
    return undefined
  }
  for (const directory of roots) { const data = visit(directory, 0); if (data) return { data } }
  return { reason }
}

export function isCompleteMp4(data: Buffer): boolean {
  if (data.length < 12 || data.toString('ascii', 4, 8) !== 'ftyp') return false
  let offset = 0, movie = false, payload = false
  while (offset + 8 <= data.length) {
    let size = data.readUInt32BE(offset)
    const box = data.toString('ascii', offset + 4, offset + 8)
    if (size === 1) {
      if (offset + 16 > data.length) break
      const extended = data.readBigUInt64BE(offset + 8)
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) break
      size = Number(extended)
    } else if (size === 0) size = data.length - offset
    if (size < 8 || offset + size > data.length) break
    if (box === 'moov') movie = true
    if (box === 'mdat') payload = true
    offset += size
  }
  return offset === data.length && movie && payload
}
