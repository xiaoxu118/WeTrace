import { createDecipheriv, createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export interface ImageKey { aes: Buffer; xor: number }
const v1 = Buffer.from('070856310807', 'hex')
const v2 = Buffer.from('070856320807', 'hex')
const keyCache = new Map<string, { signature: string; keys: ImageKey[] }>()

export function imageMime(data: Buffer): string | undefined {
  if (data.length < 12) return undefined
  if (data.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg'
  if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png'
  if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString())) return 'image/gif'
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  if (data.subarray(0, 2).toString() === 'BM') return 'image/bmp'
  return undefined
}

function recognized(data: Buffer): boolean {
  return Boolean(imageMime(data)) || data.subarray(0, 4).toString() === 'wxgf'
}

// These are image keys, separate from the database key. Keep candidates only in memory.
export function discoverImageKeys(accountRoot: string): ImageKey[] {
  const documents = path.dirname(path.dirname(accountRoot))
  const codes = new Set<string>()
  for (const base of [documents, path.dirname(accountRoot), accountRoot]) {
    for (const service of ['net', 'ilink']) {
      try {
        for (const filename of fs.readdirSync(path.join(base, 'app_data', service, 'kvcomm'))) {
          const code = /^key_(\d+)_.+\.statistic$/i.exec(filename)?.[1]
          if (code) codes.add(code)
        }
      } catch { /* Not every WeChat version has both cache directories. */ }
    }
  }
  const signature = [...codes].sort().join(',')
  const cached = keyCache.get(accountRoot)
  if (cached?.signature === signature) return cached.keys
  const account = path.basename(accountRoot)
  const normalized = account.startsWith('wxid_') ? account.match(/^(wxid_[^_]+)/)?.[1] : account.replace(/_[a-z\d]{4}$/i, '')
  const keys: ImageKey[] = []
  for (const code of codes) {
    for (const username of new Set([account, normalized].filter(Boolean))) {
      const aes = createHash('md5').update(code + username).digest('hex').slice(0, 16)
      keys.push({ aes: Buffer.from(aes, 'ascii'), xor: Number(BigInt(code) & 255n) })
    }
  }
  keyCache.set(accountRoot, { signature, keys })
  return keys
}

export function decryptImage(data: Buffer, keys: ImageKey[] = []): Buffer | undefined {
  if (data.length < 16) return undefined
  const version1 = data.subarray(0, 6).equals(v1)
  const version2 = data.subarray(0, 6).equals(v2)
  if (!version1 && !version2) {
    if (imageMime(data)) return data
    for (const first of [0xff, 0x89, 0x47, 0x52, 0x42]) {
      const xor = data[0] ^ first
      const header = Buffer.from(data.subarray(0, 16).map(byte => byte ^ xor))
      if (imageMime(header)) return Buffer.from(data.map(byte => byte ^ xor))
    }
    return undefined
  }
  const aesSize = data.readUInt32LE(6)
  const xorSize = data.readUInt32LE(10)
  const encryptedSize = (Math.floor(aesSize / 16) + 1) * 16
  const end = 15 + encryptedSize
  if (!aesSize || end > data.length || xorSize > data.length - end) return undefined
  const candidates = version1 ? [{ aes: Buffer.from('cfcd208495d565ef'), xor: 0x88 }] : keys
  for (const key of candidates) {
    try {
      const decipher = createDecipheriv('aes-128-ecb', key.aes, null)
      const head = Buffer.concat([decipher.update(data.subarray(15, end)), decipher.final()])
      if (head.length !== aesSize || !recognized(head)) continue
      const tailStart = data.length - xorSize
      const tail = data.subarray(tailStart).map(byte => byte ^ key.xor)
      return Buffer.concat([head, data.subarray(end, tailStart), tail])
    } catch { /* Incorrect candidates and corrupt padding must not break synchronization. */ }
  }
  return undefined
}

export function unwrapWxgf(data: Buffer): Buffer {
  if (data.subarray(0, 4).toString() !== 'wxgf') return data
  for (let offset = 4; offset < Math.min(data.length - 12, 4096); offset++) {
    if (data[offset] !== 0xff && data[offset] !== 0x89) continue
    const candidate = data.subarray(offset)
    const mime = imageMime(candidate)
    if (mime === 'image/jpeg' || mime === 'image/png') return candidate
  }
  return data
}

export function imageVariantNames(base: string): string[] {
  return ['_hd.dat', '_h.dat', '_h_m.dat', '.dat', '_m.dat', '_t.dat', '_t_m.dat', '_thumb.dat', '_b.dat', '_w.dat', '_c.dat', '.t.dat', '.jpg', '.png', '.webp', '.gif'].map(suffix => base + suffix)
}
