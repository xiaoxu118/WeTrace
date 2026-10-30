import { decompress } from 'fzstd'

export function blobBuffer(raw: unknown): Buffer | undefined {
  if (Buffer.isBuffer(raw)) return raw
  if (raw instanceof Uint8Array || Array.isArray(raw)) return Buffer.from(raw)
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    if (record.type === 'Buffer' && Array.isArray(record.data) && record.data.every(byte => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255)) return Buffer.from(record.data as number[])
  }
  return undefined
}

function binaryText(data: Buffer): string {
  try {
    if (data.length >= 4 && data.readUInt32LE(0) === 0xfd2fb528) {
      return Buffer.from(decompress(data)).toString('utf8')
    }
  } catch {
    return ''
  }
  const decoded = data.toString('utf8')
  return decoded.includes('\uFFFD') ? '' : decoded
}

export function decodeContent(raw: unknown): string {
  const buffer = blobBuffer(raw)
  if (buffer) return binaryText(buffer)
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (trimmed.length > 16 && trimmed.length % 2 === 0 && /^[0-9a-f]+$/i.test(trimmed)) {
    const decoded = binaryText(Buffer.from(trimmed, 'hex'))
    if (decoded) return decoded
  }
  if (trimmed.length > 16 && trimmed.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    const decoded = binaryText(Buffer.from(trimmed, 'base64'))
    if (decoded) return decoded
  }
  return trimmed
}

export function packedImageHash(raw: unknown): string | undefined {
  let buffer = blobBuffer(raw)
  if (!buffer && typeof raw === 'string') {
    const content = raw.trim()
    buffer = /^[a-f\d]+$/i.test(content) && content.length % 2 === 0 ? Buffer.from(content, 'hex') : Buffer.from(content, 'base64')
  }
  const content = buffer?.toString('latin1') ?? ''
  return /([a-f\d]{32})(?:_[th]|\.t)?\.dat/i.exec(content)?.[1].toLowerCase()
    ?? /(?:^|[^a-f\d])([a-f\d]{32})(?![a-f\d])/i.exec(content)?.[1].toLowerCase()
}
