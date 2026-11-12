import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { conversationCacheAllowed, excludedConversations } from './conversation-cache-policy.ts'

let directory = ''
const accounts = new Map<string, { root: string; key: Buffer }>()
const digest = (text: string): string => createHash('sha256').update(text).digest('hex')
export function configureRecallMediaStore(path: string): void { directory = path }
export function registerRecallMediaAccount(root: string, key: string): string {
  const id = digest(root)
  accounts.set(id, { root, key: createHash('sha256').update('wetrace-recall-media-v1\0').update(key).digest() })
  return id
}
export function retainMedia(root: string, key: string, room: string, data: Buffer, mime: string): string | undefined {
  if (!directory || !conversationCacheAllowed(root, room)) return undefined
  if (!/^(image\/(png|jpeg|gif|webp)|video\/mp4)$/.test(mime)) return undefined
  const account = registerRecallMediaAccount(root, key), roomId = digest(room), id = createHash('sha256').update(mime).update('\0').update(data).digest('hex')
  const folder = join(directory, account, roomId), file = join(folder, `${id}.bin`)
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  if (!existsSync(file)) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', accounts.get(account)!.key, iv)
    const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(mime + '\n'), data])), cipher.final()])
    const temporary = `${file}.${randomUUID()}.tmp`
    try { writeFileSync(temporary, Buffer.concat([iv, cipher.getAuthTag(), body]), { mode: 0o600, flag: 'wx' }); renameSync(temporary, file) }
    finally { rmSync(temporary, { force: true }) }
  }
  return `wetrace-media://retained/${account}/${roomId}/${id}`
}
export function excludeRecallMedia(root: string, rooms: string[]): void {
  if (!directory) return
  for (const room of rooms) rmSync(join(directory, digest(root), digest(room)), { recursive: true, force: true })
}
export function readRetainedMedia(url: string): { data: Buffer; mime: string } | undefined {
  const match = /^wetrace-media:\/\/retained\/([a-f0-9]{64})\/([a-f0-9]{64})\/([a-f0-9]{64})$/.exec(url)
  if (!directory || !match) return undefined
  const account = accounts.get(match[1])
  if (!account) return undefined
  try {
    // Re-read policy so URLs held by the UI stop working immediately after exclusion.
    if (excludedConversations(account.root).some(room => digest(room) === match[2])) return undefined
    const stored = readFileSync(join(directory, match[1], match[2], `${match[3]}.bin`))
    const cipher = createDecipheriv('aes-256-gcm', account.key, stored.subarray(0, 12))
    cipher.setAuthTag(stored.subarray(12, 28))
    const body = Buffer.concat([cipher.update(stored.subarray(28)), cipher.final()]), split = body.indexOf(10)
    const mime = body.subarray(0, split).toString()
    if (split < 0 || !/^(image\/(png|jpeg|gif|webp)|video\/mp4)$/.test(mime)) return undefined
    return { mime, data: body.subarray(split + 1) }
  } catch { return undefined }
}

export function retainedMediaResponse(url: string, range?: string | null): Response {
  const media = readRetainedMedia(url)
  if (!media) return new Response('Media unavailable', { status: 404 })
  const headers: Record<string, string> = { 'Content-Type': media.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }
  let start = 0, end = media.data.length - 1, status = 200
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${media.data.length}` } })
    start = match[1] ? Number(match[1]) : Math.max(0, media.data.length - Number(match[2]))
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= media.data.length) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${media.data.length}` } })
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${media.data.length}`
  }
  headers['Content-Length'] = String(end - start + 1)
  return new Response(new Uint8Array(media.data.subarray(start, end + 1)), { status, headers })
}
