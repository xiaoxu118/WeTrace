import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getMediaCacheStats } from '../src/main/media-cache-stats.ts'
import { VoiceTranscriptionCache } from '../src/main/voice-transcription-cache.ts'
import { ImageDescriptionCache } from '../src/main/image-description-cache.ts'

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wetrace-media-stats-'))
try {
  assert.deepEqual(await getMediaCacheStats(directory), { voice: { count: 0, bytes: 0 }, image: { count: 0, bytes: 0 } })
  const voice = new VoiceTranscriptionCache(path.join(directory, 'voice-transcriptions'))
  const image = new ImageDescriptionCache(path.join(directory, 'image-descriptions'))
  await voice.getOrTranscribe('scope', 'abcd', 'v1', async () => '语音文本')
  const describe = () => image.getOrDescribe('scope', { data: Buffer.from('image'), mime: 'image/png' }, 'v1', async () => '图片描述')
  await describe()
  await describe()
  await assert.rejects(image.getOrDescribe('scope', { data: Buffer.from('failed'), mime: 'image/png' }, 'v1', async () => { throw new Error('failed') }))
  const imageDirectory = path.join(directory, 'image-descriptions')
  await fs.writeFile(path.join(imageDirectory, 'a'.repeat(64) + '.json'), '{broken')
  await fs.writeFile(path.join(imageDirectory, 'b'.repeat(64) + '.json'), JSON.stringify({ schema: 1, key: 'b'.repeat(64), text: ' ' }))
  await fs.writeFile(path.join(imageDirectory, 'unfinished.tmp'), 'temporary')
  const stats = await getMediaCacheStats(directory)
  assert.equal(stats.voice.count, 1)
  assert.equal(stats.image.count, 1)
  assert.ok(stats.voice.bytes > 0 && stats.image.bytes > 0)
  const validFile = (await fs.readdir(imageDirectory)).find(file => !file.startsWith('a'.repeat(64)) && !file.startsWith('b'.repeat(64)) && file.endsWith('.json'))
  assert.equal(stats.image.bytes, (await fs.stat(path.join(imageDirectory, validFile))).size)
  console.log('媒体缓存统计测试通过：空目录、实际缓存数量与占用、重复复用、失败与损坏结果排除。')
} finally { await fs.rm(directory, { recursive: true, force: true }) }
