import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

let onPreview: ((id: string, data: Buffer, mime: string) => void) | undefined
export function onImagePreview(callback: typeof onPreview): void { onPreview = callback }

const previews = new Map<string, { data: Buffer; mime: string }>()
// The main process keeps session files so URLs already handed to the renderer
// survive memory eviction and the exit of the process that decoded the image.
let previewDirectory: string | undefined
export function configureImagePreviewDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  previewDirectory = directory
}
let bytes = 0
const MAX_BYTES = 48 * 1024 * 1024
const MAX_COUNT = 512

export function cacheImagePreview(data: Buffer, mime: string): string {
  const id = createHash('sha256').update(data).digest('hex')
  if (previewDirectory) {
    try {
      const file = path.join(previewDirectory, `${id}.preview`)
      if (!fs.existsSync(file)) fs.writeFileSync(file, Buffer.concat([Buffer.from(`${mime}\n`), data]), { mode: 0o600 })
    } catch { /* Memory and worker recovery remain available if temporary storage fails. */ }
  }
  if (!previews.has(id)) { previews.set(id, { data, mime }); bytes += data.length; onPreview?.(id, data, mime) }
  while (bytes > MAX_BYTES || previews.size > MAX_COUNT) {
    const oldest = previews.keys().next().value!
    bytes -= previews.get(oldest)!.data.length
    previews.delete(oldest)
  }
  return `wetrace-media://preview/${id}`
}

export function readImagePreview(id: string): { data: Buffer; mime: string } | undefined {
  if (!/^[a-f0-9]{64}$/.test(id)) return undefined
  let value = previews.get(id)
  if (!value && previewDirectory) {
    try {
      const stored = fs.readFileSync(path.join(previewDirectory, `${id}.preview`))
      const separator = stored.indexOf(10)
      if (separator > 0 && separator < 100) {
        const mime = stored.subarray(0, separator).toString()
        const data = stored.subarray(separator + 1)
        if (/^image\/[a-z0-9.+-]+$/.test(mime) && createHash('sha256').update(data).digest('hex') === id) {
          cacheImagePreview(data, mime)
          value = { data, mime }
        }
      }
    } catch { /* The preview may have been removed during application shutdown. */ }
  }
  if (value) { previews.delete(id); previews.set(id, value) }
  return value
}
