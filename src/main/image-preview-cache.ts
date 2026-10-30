import { createHash } from 'node:crypto'

let onPreview: ((id: string, data: Buffer, mime: string) => void) | undefined
export function onImagePreview(callback: typeof onPreview): void { onPreview = callback }

const previews = new Map<string, { data: Buffer; mime: string }>()
let bytes = 0
const MAX_BYTES = 48 * 1024 * 1024
const MAX_COUNT = 512

export function cacheImagePreview(data: Buffer, mime: string): string {
  const id = createHash('sha256').update(data).digest('hex')
  if (!previews.has(id)) { previews.set(id, { data, mime }); bytes += data.length; onPreview?.(id, data, mime) }
  while (bytes > MAX_BYTES || previews.size > MAX_COUNT) {
    const oldest = previews.keys().next().value!
    bytes -= previews.get(oldest)!.data.length
    previews.delete(oldest)
  }
  return `wetrace-media://preview/${id}`
}

export function readImagePreview(id: string): { data: Buffer; mime: string } | undefined {
  const value = previews.get(id)
  if (value) { previews.delete(id); previews.set(id, value) }
  return value
}
