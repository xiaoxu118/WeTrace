import assert from 'node:assert/strict'
import { decodeContent, packedImageHash } from '../src/main/message-decoding.ts'
const xml = '<msg><img md5="1234567890abcdef1234567890abcdef" /></msg>'
const blob = JSON.parse(JSON.stringify(Buffer.from(xml)))
assert.equal(decodeContent(blob), xml)
assert.equal(decodeContent(Buffer.from(xml).toString('hex')), xml)
assert.equal(decodeContent(Buffer.from(xml).toString('base64')), xml)
assert.equal(decodeContent({ type: 'Buffer', data: [999] }), '')
const packed = Buffer.concat([Buffer.from([0, 18, 34, 10, 32]), Buffer.from('1234567890abcdef1234567890abcdef_t.dat'), Buffer.from([0])])
assert.equal(packedImageHash(JSON.parse(JSON.stringify(packed))), '1234567890abcdef1234567890abcdef')
assert.equal(packedImageHash(packed.toString('hex')), '1234567890abcdef1234567890abcdef')
console.log('消息二进制解析自测通过：原生桥接 Buffer 对象、XML 内容与图片文件名。')
