import fs from 'node:fs/promises'
import path from 'node:path'
import type { MediaCacheStats } from '../shared/media-cache'

async function countEntries(directory: string): Promise<{ count: number; bytes: number }> {
  const result = { count: 0, bytes: 0 }
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-f\d]{64}\.json$/.test(entry.name)) continue
    const file = path.join(directory, entry.name)
    try {
      const stat = await fs.stat(file)
      if (stat.size > 1024 * 1024) continue
      const value = JSON.parse(await fs.readFile(file, 'utf8'))
      if (value.schema !== 1 || value.key !== entry.name.slice(0, -5) || typeof value.text !== 'string' || !value.text.trim()) continue
      result.count++
      result.bytes += stat.size
    } catch (error) {
      // Ignore damaged entries and files removed while counting; surface access errors.
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
  }
  return result
}

export async function getMediaCacheStats(directory: string): Promise<MediaCacheStats> {
  const [voice, image] = await Promise.all([
    countEntries(path.join(directory, 'voice-transcriptions')),
    countEntries(path.join(directory, 'image-descriptions')),
  ])
  return { voice, image }
}
