import assert from 'node:assert/strict'
import { createCipheriv, createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { decryptImage, discoverImageKeys, imageMime, unwrapWxgf } from '../src/main/image-decryption.ts'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=', 'base64')
const key = { aes: Buffer.from('0123456789abcdef'), xor: 0x37 }
function encrypt(data, version, aesSize, xorSize, imageKey) {
  const header = Buffer.alloc(15)
  Buffer.from(`0708563${version}0807`, 'hex').copy(header)
  header.writeUInt32LE(aesSize, 6)
  header.writeUInt32LE(xorSize, 10)
  const cipher = createCipheriv('aes-128-ecb', imageKey.aes, null)
  const aes = Buffer.concat([cipher.update(data.subarray(0, aesSize)), cipher.final()])
  return Buffer.concat([header, aes, data.subarray(aesSize, data.length - xorSize), data.subarray(data.length - xorSize).map(byte => byte ^ imageKey.xor)])
}
for (const aesSize of [16, 17, 32]) {
  for (const xorSize of [0, 8, png.length - aesSize]) {
    const encrypted = encrypt(png, 2, aesSize, xorSize, key)
    assert.deepEqual(decryptImage(encrypted, [key]), png)
    assert.equal(decryptImage(encrypted, [{ aes: Buffer.alloc(16), xor: 0 }]), undefined)
    assert.equal(decryptImage(encrypted.subarray(0, 20), [key]), undefined)
  }
}
assert.deepEqual(decryptImage(encrypt(png, 1, 32, 8, { aes: Buffer.from('cfcd208495d565ef'), xor: 0x88 })), png)
assert.deepEqual(decryptImage(Buffer.from(png.map(byte => byte ^ 0x65))), png)
assert.equal(imageMime(png), 'image/png')
assert.deepEqual(unwrapWxgf(Buffer.concat([Buffer.from('wxgf'), Buffer.alloc(20), png])), png)
const hevcContainer = Buffer.from('wxgf01234567890123456789')
assert.deepEqual(unwrapWxgf(hevcContainer), hevcContainer)
assert.equal(decryptImage(Buffer.alloc(15)), undefined)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wetrace-key-test-'))
try {
  const account = path.join(root, 'xwechat_files', 'wxid_test_abcd')
  const cache = path.join(root, 'app_data/net/kvcomm')
  fs.mkdirSync(cache, { recursive: true })
  fs.writeFileSync(path.join(cache, 'key_12345_1.statistic'), '')
  const keys = discoverImageKeys(account)
  const expected = createHash('md5').update('12345wxid_test').digest('hex').slice(0, 16)
  assert.ok(keys.some(candidate => candidate.aes.toString() === expected && candidate.xor === (12345 & 255)))
} finally { fs.rmSync(root, { recursive: true, force: true }) }
console.log('图片解密自测通过：V1/V2、AES 对齐、明文中段、异或尾段、错误密钥与损坏文件、本地密钥派生。')
