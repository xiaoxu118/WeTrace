import { parseRevokeMessage } from '../shared/revoke-message.ts'
import { localStickerLookup } from './sticker-content.ts'
import fs from 'node:fs'
import { cacheImagePreview } from './image-preview-cache.ts'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { decryptImage, discoverImageKeys, imageMime, imageVariantNames, unwrapWxgf, type ImageKey } from './image-decryption.ts'
import type { SyncMessage } from '../shared/types'

export function stripGroupSender(content: string): { sender: string; content: string } {
  const match = /^([^\s<>:]{1,128}):\r?\n/.exec(content)
  return match ? { sender: match[1], content: content.slice(match[0].length) } : { sender: '', content }
}

function unescapeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => {
    const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
  }).replace(/&(lt|gt|quot|apos|amp);/g, (_, key: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[key]!)
}

function tag(xml: string, name: string): string {
  return unescapeXml(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(xml)?.[1] ?? '').trim()
}

function systemMessageText(content: string): string {
  // Only interpret structured system messages; plain notices may contain literal angle brackets.
  const xml = content.trim().replace(/^<\?xml\b[^?]*\?>\s*/i, '')
  if (!/^<(?:sysmsg|msg)\b/i.test(xml)) return content || '[系统消息]'
  const template = tag(xml, 'template')
  if (template) {
    const replacements = new Map<string, string>()
    for (const match of xml.matchAll(/<link\b([^>]*)>([\s\S]*?)<\/link>/gi)) {
      const name = /\bname\s*=\s*(["'])(.*?)\1/i.exec(match[1])?.[2]
      if (!name) continue
      const members = [...match[2].matchAll(/<member\b[^>]*>([\s\S]*?)<\/member>/gi)]
        .map(member => tag(member[1], 'nickname') || tag(member[1], 'displayname')).filter(Boolean)
      const label = members.join('、') || tag(match[2], 'title') || tag(match[2], 'plain')
      if (label) replacements.set(name, label)
    }
    return template.replace(/\$([\w]+)\$/g, (_, name: string) => replacements.get(name) || '相关成员')
  }
  // Do not concatenate XML leaves: they also contain internal IDs and action URLs.
  for (const name of ['plain', 'content', 'text', 'title']) {
    const text = tag(xml, name)
    if (text && !/<\/?[a-z][^>]*>/i.test(text)) return text
  }
  return '[系统消息]'
}

// Read the record envelope before decoding it: its CDATA can itself contain XML CDATA.
function forwardedRecord(xml: string): SyncMessage['forwarded'] {
  const raw = /<recorditem\b[^>]*>([\s\S]*?)<\/recorditem>/i.exec(xml)?.[1]
  const record = raw === undefined ? '' : raw.trim().startsWith('<![CDATA[')
    ? raw.trim().slice(9, -3) : unescapeXml(raw)
  const entries: NonNullable<SyncMessage['forwarded']>['entries'] = []
  // Nested forwarded records remain a labelled entry, so their items are not attributed to the outer sender.
  const items = record.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, value => value.replace(/<\/dataitem>/gi, '&lt;/dataitem&gt;'))
  for (const match of items.matchAll(/<dataitem\b([^>]*)>([\s\S]*?)<\/dataitem>/gi)) {
    const type = Number(/\bdatatype\s*=\s*["'](\d+)["']/i.exec(match[1])?.[1])
    const body = match[2]
    const description = tag(body, 'datadesc')
    const title = tag(body, 'datatitle')
    const labels: Record<number, string> = { 2: '[图片]', 3: '[语音]', 4: '[视频]', 6: '[位置]', 7: '[链接]', 8: '[文件]', 14: '[合并聊天记录]' }
    const text = type === 1 ? description || title || '[文本内容不可用]'
      : [labels[type] || '[其他消息]', title, type === 14 ? '' : description].filter(Boolean).join(' ')
    entries.push({ messageType: ({ 2: 3, 3: 34, 4: 43 } as Record<number, number>)[type] ?? 1, sender: tag(body, 'sourcename') || tag(body, 'fromusr') || '微信用户', time: tag(body, 'sourcetime') || undefined, text })
  }
  return { title: tag(record, 'title') || '合并聊天记录', entries,
    unavailable: entries.length ? undefined : '本地消息未包含可解析的完整聊天记录，可能尚未下载到本机' }
}

export function webUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined
  } catch { return undefined }
}

const stickerLookups = new WeakMap<Map<string, string[]>, (hash: string) => string[]>()
const imageKeys = new WeakMap<Map<string, string[]>, ImageKey[]>()

// Look up exact filenames within this conversation. Avoid reading the entire image archive on each refresh.
export function localImages(root: string, username?: string): Map<string, string[]> {
  const cache = new Map<string, string[]>()
  const attachment = path.join(root, 'msg/attach')
  let directories: string[] | undefined
  const lookup = (): string[] => {
    if (directories) return directories
    directories = []
    const roots = username ? [path.join(attachment, createHash('md5').update(username).digest('hex'))] : [attachment]
    function visit(directory: string, depth: number): void {
      if (depth > (username ? 3 : 4)) return
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch { return }
      // File entries are intentionally not indexed; only directories are retained.
      if (path.basename(directory).toLowerCase() === 'img' || path.basename(directory).toLowerCase() === 'image') directories!.push(directory)
      for (const entry of entries) if (entry.isDirectory()) visit(path.join(directory, entry.name), depth + 1)
    }
    for (const base of roots) visit(base, 0)
    visit(path.join(root, 'FileStorage/Image'), 0)
    return directories
  }
  const get = cache.get.bind(cache)
  cache.get = (hash: string) => {
    const existing = get(hash)
    if (existing) return existing
    if (!/^[a-f\d]{32}$/i.test(hash)) return undefined
    const files: string[] = []
    for (const directory of lookup()) {
      for (const filename of imageVariantNames(hash)) {
        const file = path.join(directory, filename)
        try { if (fs.statSync(file).isFile()) files.push(file) } catch { /* Resource not downloaded in this month. */ }
      }
    }
    cache.set(hash, files)
    return files
  }
  stickerLookups.set(cache, localStickerLookup(root))
  imageKeys.set(cache, discoverImageKeys(root))
  return cache
}

export function presentMessage(type: number, content: string, images: Map<string, string[]>, fileHash?: string): Pick<SyncMessage, 'text' | 'revoke' | 'image' | 'sticker' | 'link' | 'quote' | 'forwarded'> {
  switch (type >>> 0) {
    case 1: return { text: content || '[文本]' }
    case 3: {
      const xmlHash = /\bmd5\s*=\s*["']([a-f\d]{32})["']/i.exec(content)?.[1] || tag(content, 'md5')
      const hashes = [...new Set([fileHash, xmlHash.toLowerCase()].filter((hash): hash is string => Boolean(hash && /^[a-f\d]{32}$/i.test(hash))))]
      const files = [...new Set(hashes.flatMap(hash => images.get(hash) ?? []))].sort((left, right) => Number(/(?:_t(?:_m)?|_thumb|_[bwc]|\.t)\.dat$/i.test(left)) - Number(/(?:_t(?:_m)?|_thumb|_[bwc]|\.t)\.dat$/i.test(right)))
      let decryptedUnsupported = false
      let best: { data: Buffer; mime: string; thumbnail: boolean } | undefined
      for (const file of files) {
        try {
          if (fs.statSync(file).size > 20 * 1024 * 1024) continue
          const decrypted = decryptImage(fs.readFileSync(file), imageKeys.get(images))
          const decoded = decrypted && unwrapWxgf(decrypted)
          const mime = decoded && imageMime(decoded)
          if (decoded && !mime) decryptedUnsupported = true
          if (decoded && mime) {
            const thumbnail = /(?:_t(?:_m)?|_thumb|_[bwc]|\.t)\.dat$/i.test(file) || decrypted?.subarray(0, 4).toString() === 'wxgf'
            if (!best || (best.thumbnail && !thumbnail) || best.thumbnail === thumbnail && decoded.length > best.data.length) best = { data: decoded, mime, thumbnail }
          }
        } catch { /* Missing files must not interrupt synchronization. */ }
      }
      if (best) return { text: '[图片]', image: { source: cacheImagePreview(best.data, best.mime), thumbnail: best.thumbnail } }
      const found = files
      const unavailable = !found.length ? '图片尚未下载到本机'
        : decryptedUnsupported ? '图片已解密，但微信专用格式暂不能显示；请在微信中打开图片以生成缩略图后刷新'
        : !imageKeys.get(images)?.length ? '未找到图片密钥，请在微信中打开一张图片后刷新'
        : '图片解密失败或格式暂不支持，请在微信中打开原图后刷新'
      return { text: '[图片]', image: { unavailable } }
    }
    case 49: {
      const xml = /<appmsg\b[^>]*>([\s\S]*?)<\/appmsg>/i.exec(content)?.[1] ?? content
      if (Number(tag(xml, 'type')) === 19) {
        const forwarded = forwardedRecord(xml)!
        forwarded.title = tag(xml.split(/<recorditem\b/i)[0], 'title') || forwarded.title
        return { text: [forwarded.title, ...forwarded.entries.map(entry => `${entry.sender}: ${entry.text}`), forwarded.unavailable].filter(Boolean).join('\n'), forwarded }
      }
      const reference = /<refermsg\b[^>]*>([\s\S]*?)<\/refermsg>/i.exec(xml)?.[1]
      const body = xml.replace(/<refermsg\b[^>]*>[\s\S]*?<\/refermsg>/gi, '')
      const title = tag(body, 'title')
      if (reference) {
        const quotedType = Number(tag(reference, 'type'))
        const raw = tag(reference, 'content')
        const summary = quotedType === 1 ? raw
          : quotedType === 3 ? '[图片]' : quotedType === 34 ? '[语音]'
          : quotedType === 43 ? '[视频]' : quotedType === 47 ? '[表情]'
          : quotedType === 49 ? tag(raw, 'title') || '[链接或文件]' : raw.replace(/<[^>]*>/g, '').trim()
        return { text: title || '[引用消息]', quote: { sender: tag(reference, 'displayname') || tag(reference, 'chatusr') || tag(reference, 'fromusr') || '微信用户', text: summary || '[消息内容不可用]', type: quotedType || undefined, messageId: tag(reference, 'svrid') || undefined } }
      }
      const url = webUrl(tag(xml, 'url'))
      if (url) return { text: title || url, link: { url, title: title || url, description: tag(xml, 'des') || undefined } }
      return { text: title || '[链接或文件]' }
    }
    case 34: return { text: '[语音]' }
    case 43: return { text: '[视频]' }
    case 47: {
      const emoji = /<emoji\b([^>]*)>/i.exec(content)?.[1] || ''
      const rawHash = /\bmd5\s*=\s*["']([a-f\d]{32})["']/i.exec(emoji)?.[1] || tag(content, 'md5')
      const hash = /^[a-f\d]{32}$/i.test(rawHash) ? rawHash.toLowerCase() : undefined
      const cdnUrl = webUrl(unescapeXml(/\b(?:cdnurl|url)\s*=\s*(["'])([\s\S]*?)\1/i.exec(emoji)?.[2] || tag(content, 'url')))
      const label = unescapeXml(/\bdesc\s*=\s*["']([^"']*)["']/i.exec(emoji)?.[1] || '').trim().slice(0, 120)
      const text = label ? `[表情] ${label}` : '[表情]'
      const files = hash ? [...new Set([...(stickerLookups.get(images)?.(hash) || []), ...(images.get(hash) || [])])] : []
      for (const file of files) {
        try {
          if (!fs.lstatSync(file).isFile() || fs.statSync(file).size > 20 * 1024 * 1024) continue
          const data = fs.readFileSync(file)
          const mime = imageMime(data)
          if (mime) return { text, sticker: { source: cacheImagePreview(data, mime), label: label || '表情包', md5: hash } }
        } catch { /* Invalid media must not interrupt chat browsing. */ }
      }
      return { text, sticker: { label: label || '表情包', md5: hash, cdnUrl, unavailable: files.length ? '本地表情包格式暂不支持' : '未找到可显示的本地表情包，请在微信中打开后刷新' } }
    }
    case 48: return { text: '[位置]' }
    case 10000:
    case 10002: {
      const revoke = parseRevokeMessage(type, content)
      return revoke ? { text: revoke.notice, revoke: { targetId: revoke.targetId } } : { text: systemMessageText(content) }
    }
    default: return { text: '[其他消息]' }
  }
}
