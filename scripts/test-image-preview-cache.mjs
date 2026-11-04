import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cacheImagePreview, readImagePreview, configureImagePreviewDirectory } from '../src/main/image-preview-cache.ts'
const first = Buffer.from('first preview')
const source = cacheImagePreview(first, 'image/png')
assert.equal(cacheImagePreview(first, 'image/png'), source)
assert.deepEqual(readImagePreview(source.split('/').pop()).data, first)
for (let index = 0; index < 513; index++) {
  const data = Buffer.alloc(16)
  data.writeUInt32LE(index)
  cacheImagePreview(data, 'image/png')
}
assert.equal(readImagePreview(source.split('/').pop()), undefined)
assert.equal(readImagePreview('not-a-real-id'), undefined)
console.log('图片预览缓存自测通过：稳定地址、重复复用与缓存淘汰。')

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wetrace-preview-test-'))
try {
  configureImagePreviewDirectory(directory)
  const data = Buffer.from('preview must outlive the decoding worker and memory cache')
  const id = cacheImagePreview(data, 'image/jpeg').split('/').pop()
  // A different conversation/report can produce enough previews to evict this URL.
  for (let index = 0; index < 513; index++) {
    cacheImagePreview(Buffer.from(`other conversation ${index}`), 'image/png')
  }
  assert.deepEqual(readImagePreview(id), { data, mime: 'image/jpeg' })
  assert.equal(readImagePreview('../outside'), undefined)
  const corruptId = 'a'.repeat(64)
  fs.writeFileSync(path.join(directory, `${corruptId}.preview`), 'image/png\ncorrupted')
  assert.equal(readImagePreview(corruptId), undefined)
  assert.equal(fs.statSync(path.join(directory, `${id}.preview`)).mode & 0o777, 0o600)
  console.log('图片预览恢复通过：跨会话缓存淘汰后仍能读取、拒绝越界路径及损坏缓存，临时文件仅当前用户可读。')
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
