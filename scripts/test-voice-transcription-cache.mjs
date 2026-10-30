import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VoiceTranscriptionCache } from '../src/main/voice-transcription-cache.ts'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wetrace-voice-cache-'))
try {
  const directory = path.join(root, 'voice')
  const cache = new VoiceTranscriptionCache(directory)
  let conversions = 0
  const convert = async () => { conversions++; return ' 本地识别文本 ' }
  assert.deepEqual(await cache.getOrTranscribe('account/chat', '1234', 'model-v1', convert), { text: '本地识别文本', fromCache: false })
  assert.equal((await cache.getOrTranscribe('account/chat', '1234', 'model-v1', convert)).fromCache, true)
  assert.equal(conversions, 1)
  const restarted = new VoiceTranscriptionCache(directory)
  assert.equal((await restarted.getOrTranscribe('account/chat', '1234', 'model-v1', convert)).fromCache, true)
  assert.equal(conversions, 1, '重启后从磁盘复用，不重新识别')
  const files = await fs.readdir(directory)
  assert.equal(files.length, 1)
  assert.equal((await fs.stat(path.join(directory, files[0]))).mode & 0o777, 0o600)
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, files[0]), 'utf8')).text, '本地识别文本')
  await restarted.getOrTranscribe('account/chat', '1234', 'model-v2', convert)
  await restarted.getOrTranscribe('account/chat', '123456', 'model-v1', convert)
  await restarted.getOrTranscribe('other-account/chat', '1234', 'model-v1', convert)
  assert.equal(conversions, 4, '模型、音频或会话变化时不复用旧内容')
  await fs.writeFile(path.join(directory, files[0]), '{broken')
  assert.equal((await new VoiceTranscriptionCache(directory).getOrTranscribe('account/chat', '1234', 'model-v1', convert)).fromCache, false)
  assert.equal(conversions, 5, '损坏缓存自动重建')
  let release
  const gate = new Promise(resolve => { release = resolve })
  let concurrentCalls = 0
  const concurrent = () => cache.getOrTranscribe('same', 'aabb', 'v1', async () => { concurrentCalls++; await gate; return '并发结果' })
  const first = concurrent()
  const second = concurrent()
  release()
  const results = await Promise.all([first, second])
  assert.equal(concurrentCalls, 1)
  assert.equal(results[0].text, results[1].text)
  let attempts = 0
  await assert.rejects(cache.getOrTranscribe('failure', 'abcd', 'v1', async () => { attempts++; throw new Error('识别失败') }), /识别失败/)
  await cache.getOrTranscribe('failure', 'abcd', 'v1', async () => { attempts++; return '重试成功' })
  assert.equal(attempts, 2, '失败结果不会缓存')
  await assert.rejects(cache.getOrTranscribe('empty', 'abcd', 'v1', async () => ' '), /有效语音/)
  await assert.rejects(cache.getOrTranscribe('invalid', 'xyz', 'v1', convert), /格式无效/)
  assert.ok((await fs.readdir(directory)).every(file => file.endsWith('.json')), '没有残留未完成缓存')
  const blocked = path.join(root, 'not-a-directory')
  await fs.writeFile(blocked, '')
  const blockedCache = new VoiceTranscriptionCache(blocked)
  let blockedCalls = 0
  const result = await blockedCache.getOrTranscribe('scope', 'aabb', 'v1', async () => { blockedCalls++; return '仍可使用的文本' })
  assert.equal(result.text, '仍可使用的文本')
  assert.match(result.warning, /缓存写入失败/)
  assert.equal((await blockedCache.getOrTranscribe('scope', 'aabb', 'v1', async () => { blockedCalls++; return '重复识别' })).fromCache, true)
  assert.equal(blockedCalls, 1)
  console.log('语音缓存测试通过：成功即落盘、重启复用、模型与音频校验、并发去重、损坏重建、失败重试及写入失败处理。')
} finally { await fs.rm(root, { recursive: true, force: true }) }
