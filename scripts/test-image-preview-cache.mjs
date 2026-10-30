import assert from 'node:assert/strict'
import { cacheImagePreview, readImagePreview } from '../src/main/image-preview-cache.ts'
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
