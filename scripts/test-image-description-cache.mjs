import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ImageDescriptionCache } from '../src/main/image-description-cache.ts'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wetrace-voice-cache-'))
try {
  const directory = path.join(root, 'voice')
  const cache = new ImageDescriptionCache(directory)
  let conversions = 0
  const convert = async () => { conversions++; return ' 本地理解文本 ' }
  assert.deepEqual(await cache.getOrDescribe('account/chat', { data: Buffer.from('1234', 'hex'), mime: 'image/png' }, 'model-v1', convert), { text: '本地理解文本', fromCache: false })
  assert.equal((await cache.getOrDescribe('account/chat', { data: Buffer.from('1234', 'hex'), mime: 'image/png' }, 'model-v1', convert)).fromCache, true)
  assert.equal(conversions, 1)
  const restarted = new ImageDescriptionCache(directory)
  assert.equal((await restarted.getOrDescribe('account/chat', { data: Buffer.from('1234', 'hex'), mime: 'image/png' }, 'model-v1', convert)).fromCache, true)
  assert.equal(conversions, 1, '重启后从磁盘复用，不重新理解')
  const files = await fs.readdir(directory)
  assert.equal(files.length, 1)
  assert.equal((await fs.stat(path.join(directory, files[0]))).mode & 0o777, 0o600)
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, files[0]), 'utf8')).text, '本地理解文本')
  await restarted.getOrDescribe('account/chat', { data: Buffer.from('1234', 'hex'), mime: 'image/png' }, 'model-v2', convert)
  await restarted.getOrDescribe('account/chat', { data: Buffer.from('123456', 'hex'), mime: 'image/png' }, 'model-v1', convert)
  await restarted.getOrDescribe('other-account/chat', { data: Buffer.from('1234', 'hex'), mime: 'image/png' }, 'model-v1', convert)
  assert.equal(conversions, 4, '模型、图片或会话变化时不复用旧内容')
  await fs.writeFile(path.join(directory, files[0]), '{broken')
  assert.equal((await new ImageDescriptionCache(directory).getOrDescribe('account/chat', { data: Buffer.from('1234', 'hex'), mime: 'image/png' }, 'model-v1', convert)).fromCache, false)
  assert.equal(conversions, 5, '损坏缓存自动重建')
  let release
  const gate = new Promise(resolve => { release = resolve })
  let concurrentCalls = 0
  const concurrent = () => cache.getOrDescribe('same', { data: Buffer.from('aabb', 'hex'), mime: 'image/png' }, 'v1', async () => { concurrentCalls++; await gate; return '并发结果' })
  const first = concurrent()
  const second = concurrent()
  release()
  const results = await Promise.all([first, second])
  assert.equal(concurrentCalls, 1)
  assert.equal(results[0].text, results[1].text)
  let attempts = 0
  await assert.rejects(cache.getOrDescribe('failure', { data: Buffer.from('abcd', 'hex'), mime: 'image/png' }, 'v1', async () => { attempts++; throw new Error('理解失败') }), /理解失败/)
  await cache.getOrDescribe('failure', { data: Buffer.from('abcd', 'hex'), mime: 'image/png' }, 'v1', async () => { attempts++; return '重试成功' })
  assert.equal(attempts, 2, '失败结果不会缓存')
  await assert.rejects(cache.getOrDescribe('empty', { data: Buffer.from('abcd', 'hex'), mime: 'image/png' }, 'v1', async () => ' '), /有效图片描述/)
  await assert.rejects(cache.getOrDescribe('invalid', { data: Buffer.alloc(0), mime: 'image/png' }, 'v1', convert), /格式无效/)
  assert.ok((await fs.readdir(directory)).every(file => file.endsWith('.json')), '没有残留未完成缓存')
  const blocked = path.join(root, 'not-a-directory')
  await fs.writeFile(blocked, '')
  const blockedCache = new ImageDescriptionCache(blocked)
  let blockedCalls = 0
  const result = await blockedCache.getOrDescribe('scope', { data: Buffer.from('aabb', 'hex'), mime: 'image/png' }, 'v1', async () => { blockedCalls++; return '仍可使用的文本' })
  assert.equal(result.text, '仍可使用的文本')
  assert.match(result.warning, /缓存写入失败/)
  assert.equal((await blockedCache.getOrDescribe('scope', { data: Buffer.from('aabb', 'hex'), mime: 'image/png' }, 'v1', async () => { blockedCalls++; return '重复理解' })).fromCache, true)
  assert.equal(blockedCalls, 1)
  console.log('图片理解缓存测试通过：成功即落盘、重启复用、模型与图片校验、并发去重、损坏重建、失败重试及写入失败处理。')
} finally { await fs.rm(root, { recursive: true, force: true }) }
