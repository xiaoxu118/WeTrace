import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { imageMime } from './image-decryption.ts'
import { cacheImagePreview } from './image-preview-cache.ts'
import type { StickerResponse } from '../shared/sticker'

const MAX_BYTES = 20 * 1024 * 1024
export function stickerUrl(raw: string): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('表情包地址无效') }
  const host = url.hostname.toLowerCase()
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))
    || !['qpic.cn', 'qq.com', 'wechat.com'].some(domain => host === domain || host.endsWith(`.${domain}`))) throw new Error('表情包地址不是支持的微信资源地址')
  return url.href
}
async function download(url: string, fetcher: typeof fetch): Promise<Buffer> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000)
  try {
    for (let redirect = 0; redirect <= 5; redirect++) {
      const response = await fetcher(stickerUrl(url), { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 MicroMessenger WeTrace', Referer: 'https://weixin.qq.com/' } })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get('location')
        await response.body?.cancel()
        if (!next) throw new Error('表情包重定向地址缺失')
        url = new URL(next, url).href
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error([403, 404, 410].includes(response.status) ? '表情包链接已过期或不可访问，请在微信中重新打开后重试' : `表情包下载失败（${response.status}）`)
      }
      if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw new Error('表情包文件超过 20 MB') }
      const reader = response.body?.getReader()
      if (!reader) throw new Error('表情包内容为空')
      const chunks: Buffer[] = []; let size = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.length
          if (size > MAX_BYTES) { await reader.cancel(); throw new Error('表情包文件超过 20 MB') }
          chunks.push(Buffer.from(value))
        }
      } finally { reader.releaseLock() }
      const buffer = Buffer.concat(chunks)
      if (!imageMime(buffer)) throw new Error('表情包响应不是支持的图片格式，可能是加密文件')
      return buffer
    }
    throw new Error('表情包重定向次数过多')
  } catch (error) {
    if (controller.signal.aborted) throw new Error('表情包下载超时，请重试')
    throw error
  } finally { clearTimeout(timer) }
}
export class StickerResolver {
  private pending = new Map<string, Promise<StickerResponse>>()
  private queue: (() => void)[] = []
  private active = 0
  private directory: string
  private fetcher: typeof fetch
  constructor(directory: string, fetcher: typeof fetch = fetch) { this.directory = directory; this.fetcher = fetcher }
  resolve(account: string, md5: string | undefined, cdnUrl: string | undefined, lookup: () => Promise<string | undefined>): Promise<StickerResponse> {
    if (md5 && !/^[a-f\d]{32}$/i.test(md5)) return Promise.resolve({ ok: false, error: '表情包标识无效' })
    if (!md5 && !cdnUrl) return Promise.resolve({ ok: false, error: '该消息缺少表情包标识和下载地址' })
    const key = createHash('sha256').update(JSON.stringify([account, md5?.toLowerCase() || cdnUrl])).digest('hex')
    const existing = this.pending.get(key)
    if (existing) return existing
    const task = this.run(key, cdnUrl, lookup).catch(error => ({ ok: false as const, error: error instanceof Error ? error.message : '表情包加载失败' })).finally(() => this.pending.delete(key))
    this.pending.set(key, task)
    return task
  }
  private async run(key: string, cdnUrl: string | undefined, lookup: () => Promise<string | undefined>): Promise<StickerResponse> {
    const file = join(this.directory, `${key}.sticker`)
    try {
      const data = await readFile(file), mime = imageMime(data)
      if (mime && data.length <= MAX_BYTES) return { ok: true, source: cacheImagePreview(data, mime) }
    } catch { /* Continue with URL lookup when the cache is missing. */ }
    if (this.active >= 3) await new Promise<void>(resolve => this.queue.push(resolve))
    else this.active++
    try {
      let url = cdnUrl || await lookup()
      if (!url) throw new Error('本地没有可用表情包，微信表情库也未提供下载地址')
      let data: Buffer
      try { data = await download(url, this.fetcher) }
      catch (error) {
        if (!cdnUrl) throw error
        url = await lookup()
        if (!url || url === cdnUrl) throw error
        data = await download(url, this.fetcher)
      }
      const mime = imageMime(data)!
      try { await mkdir(this.directory, { recursive: true, mode: 0o700 }); await writeFile(`${file}.tmp`, data, { mode: 0o600 }); await rename(`${file}.tmp`, file) } catch { /* Display remains available if disk caching fails. */ }
      return { ok: true, source: cacheImagePreview(data, mime) }
    } finally { const next = this.queue.shift(); if (next) next(); else this.active-- }
  }
}
