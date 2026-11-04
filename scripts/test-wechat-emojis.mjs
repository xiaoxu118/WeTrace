import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { splitWechatEmojis } from '../src/shared/wechat-emojis.ts'
import { presentMessage, localImages } from '../src/main/message-content.ts'
import { readImagePreview } from '../src/main/image-preview-cache.ts'
import { localStickerLookup } from '../src/main/sticker-content.ts'
const text = '收到[微笑][捂脸]，明天继续[加油] 😀 [不存在的表情][图片]'
const parts = splitWechatEmojis(text)
assert.equal(parts.map(part => part.text).join(''), text, '解析不能改写原始文字')
assert.deepEqual(parts.filter(part => part.emoji).map(part => part.text), ['[微笑]', '[捂脸]', '[加油]'])
assert.deepEqual(splitWechatEmojis('[constructor][__proto__]'), [{ text: '[constructor][__proto__]' }])
assert.deepEqual(splitWechatEmojis('普通文字'), [{ text: '普通文字' }])
assert.deepEqual(splitWechatEmojis(''), [{ text: '' }])
assert.equal(splitWechatEmojis('[微笑\n]')[0].emoji, undefined)
assert.equal(presentMessage(1, text, new Map()).text, text)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wetrace-sticker-'))
const hash = '1234567890abcdef1234567890abcdef'
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
try {
 const directory = path.join(root, 'emoticon', 'nested')
 fs.mkdirSync(directory, { recursive: true })
 fs.writeFileSync(path.join(directory, `${hash}.gif`), gif)
 const images = localImages(root, 'fictional@chatroom')
 const sticker = presentMessage(47, `<msg><emoji md5="${hash}" desc="开心 &amp; 快乐" cdnurl="https://example.invalid/do-not-fetch" /></msg>`, images)
 assert.equal(sticker.text, '[表情] 开心 & 快乐')
 assert.equal(sticker.sticker.label, '开心 & 快乐')
 assert.equal(sticker.sticker.md5, hash)
 assert.match(sticker.sticker.source, /^wetrace-media:\/\/preview\/[a-f\d]{64}$/)
 assert.equal(readImagePreview(sticker.sticker.source.split('/').pop()).mime, 'image/gif')
 assert.deepEqual(readImagePreview(sticker.sticker.source.split('/').pop()).data, gif)
 const missing = presentMessage(47, '<emoji md5="ffffffffffffffffffffffffffffffff" cdnurl="file:///etc/passwd" />', images)
 assert.equal(missing.sticker.source, undefined)
 assert.match(missing.sticker.unavailable, /未找到/)
 assert.equal(presentMessage(47, '<emoji md5="../../secrets" />', images).sticker.md5, undefined)
 fs.writeFileSync(path.join(directory, `${hash}.gif`), 'encrypted or unsupported')
 assert.match(presentMessage(47, `<emoji md5="${hash}" />`, images).sticker.unavailable, /格式暂不支持/)
 const linked = path.join(root, 'linked-account')
 fs.mkdirSync(linked)
 fs.symlinkSync(path.join(root, 'emoticon'), path.join(linked, 'emoji'))
 assert.deepEqual(localStickerLookup(linked)(hash), [], '不能跟随符号链接读取账号目录外的表情包')
 const cacheHash = 'abcdef0123456789abcdef0123456789'
 const monthDirectory = path.join(root, 'cache', '2026-11', 'Emoticon', cacheHash.slice(0,2))
 fs.mkdirSync(monthDirectory, { recursive:true })
 fs.writeFileSync(path.join(monthDirectory, cacheHash), gif)
 const cachedSticker = presentMessage(47, `<emoji md5="${cacheHash}" />`, localImages(root, 'fictional@chatroom'))
 assert.ok(cachedSticker.sticker.source, '应读取微信按年月和哈希前缀存放的无后缀表情包')
 assert.deepEqual(readImagePreview(cachedSticker.sticker.source.split('/').pop()).data, gif)
 assert.equal(presentMessage(47, '<emoji />', new Map()).text, '[表情]')
} finally { fs.rmSync(root, { recursive: true, force: true }) }
console.log('表情解析测试通过：常用文字表情、原文保留、未知表情、本地 GIF、缺失/不支持格式、无网络回退及路径边界。')
