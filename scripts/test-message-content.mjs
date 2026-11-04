import assert from 'node:assert/strict'
import { readImagePreview } from '../src/main/image-preview-cache.ts'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripGroupSender, presentMessage, localImages, webUrl } from '../src/main/message-content.ts'

assert.deepEqual(stripGroupSender('wxid_alice:\n你好'), { sender: 'wxid_alice', content: '你好' })
assert.deepEqual(stripGroupSender('你好\n第二行'), { sender: '', content: '你好\n第二行' })
assert.deepEqual(stripGroupSender('<msg>内容</msg>'), { sender: '', content: '<msg>内容</msg>' })
const link = presentMessage(49, '<msg><appmsg><title><![CDATA[A & B]]></title><des>介绍</des><url>https://example.com/?a=1&amp;b=2</url></appmsg></msg>', new Map())
assert.equal(link.link.title, 'A & B')
assert.equal(link.link.url, 'https://example.com/?a=1&b=2')
assert.equal(webUrl('javascript:alert(1)'), undefined)
assert.equal(presentMessage(49, '<appmsg><title>文件.pdf</title><type>6</type></appmsg>', new Map()).text, '文件.pdf')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wetrace-images-'))
try {
  const directory = path.join(root, 'msg/attach', createHash('md5').update('test@chatroom').digest('hex'), '2026-10', 'Img')
  fs.mkdirSync(directory, { recursive: true })
  const hash = '1234567890abcdef1234567890abcdef'
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=', 'base64')
  fs.writeFileSync(path.join(directory, `${hash}_t_m.dat`), png.map(byte => byte ^ 0x65))
  const images = localImages(root, 'test@chatroom')
  const image = presentMessage(3, `<msg><img md5="${hash}" /></msg>`, images)
  assert.equal(image.image.thumbnail, true)
  assert.match(image.image.source, /^wetrace-media:\/\/preview\/[a-f0-9]{64}$/)
  assert.deepEqual(readImagePreview(image.image.source.split('/').pop()).data, png)
  assert.equal(presentMessage(3, '<msg><img /></msg>', images, hash).image.source, image.image.source)
  assert.equal(presentMessage(3, `<msg><md5>${hash}</md5></msg>`, images).image.source, image.image.source)
  assert.ok(presentMessage(3, '<msg><img /></msg>', images).image.unavailable)
  const original = Buffer.concat([png, Buffer.from('original-fixture')])
  const originalPath = path.join(directory, `${hash}.dat`)
  fs.writeFileSync(originalPath, original.map(byte => byte ^ 0x65))
  const candidates = new Map([[hash, [path.join(directory, `${hash}_t_m.dat`), originalPath]]])
  assert.notEqual(presentMessage(3, `<img md5="${hash}" />`, candidates).image.source, image.image.source)
  assert.equal(presentMessage(3, `<img md5="${hash}" />`, candidates).image.thumbnail, false)
  const largerPath = path.join(directory, `${hash}_hd.dat`)
  const larger = Buffer.concat([original, Buffer.alloc(100)])
  fs.writeFileSync(largerPath, larger.map(byte => byte ^ 0x65))
  const multipleOriginals = new Map([[hash, [originalPath, largerPath]]])
  const chosen = presentMessage(3, `<img md5="${hash}" />`, multipleOriginals).image
  assert.deepEqual(readImagePreview(chosen.source.split('/').pop()).data, larger)
  fs.writeFileSync(originalPath, Buffer.from('unsupported-encryption'))
  assert.equal(presentMessage(3, `<img md5="${hash}" />`, candidates).image.source, image.image.source)
  fs.writeFileSync(path.join(directory, `${hash}_t_m.dat`), Buffer.from('unsupported-encryption'))
  assert.ok(presentMessage(3, `<img md5="${hash}" />`, images).image.unavailable)
} finally { fs.rmSync(root, { recursive: true, force: true }) }
console.log('消息解析自测通过：群聊发送者、分享链接、文件标题、本地图片和不可用状态。')

const quote = presentMessage(49, '<msg><appmsg><type>57</type><title><![CDATA[哈哈哈哈哈]]></title><refermsg><type>1</type><displayname><![CDATA[群昵称]]></displayname><content><![CDATA[被引用的原话]]></content><svrid>123</svrid></refermsg></appmsg></msg>', new Map())
assert.equal(quote.text, '哈哈哈哈哈')
assert.deepEqual(quote.quote, { sender: '群昵称', text: '被引用的原话', type: 1, messageId: '123' })
assert.equal(presentMessage(1, '【哈哈哈哈哈】', new Map()).text, '【哈哈哈哈哈】')
const quotedImage = presentMessage(49, '<appmsg><title>看这张图</title><refermsg><type>3</type><displayname>A</displayname><content>&lt;img md5="private" /&gt;</content></refermsg></appmsg>', new Map())
assert.equal(quotedImage.quote.text, '[图片]')

const record = '<recordinfo><title>群聊记录</title><datalist count="3"><dataitem datatype="1"><sourcename>小明</sourcename><sourcetime>2026-10-30 10:00</sourcetime><datadesc><![CDATA[你好 <朋友> & 大家]]></datadesc></dataitem><dataitem datatype="2"><sourcename>小红</sourcename></dataitem><dataitem datatype="8"><sourcename>小明</sourcename><datatitle>资料.pdf</datatitle></dataitem></datalist></recordinfo>'
const wrapRecord = value => `<msg><appmsg><title>小明和小红的聊天记录</title><type>19</type><recorditem>${value}</recorditem></appmsg></msg>`
for (const encoded of [record, record.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')]) {
  const result = presentMessage(49, wrapRecord(encoded), new Map())
  assert.equal(result.forwarded.title, '小明和小红的聊天记录')
  assert.equal(result.forwarded.entries.length, 3)
  assert.equal(result.forwarded.entries[0].text, '你好 <朋友> & 大家')
  assert.equal(result.forwarded.entries[0].sender, '小明')
  assert.equal(result.forwarded.entries[0].time, '2026-10-30 10:00')
  assert.equal(result.forwarded.entries[1].text, '[图片]')
  assert.equal(result.forwarded.entries[2].text, '[文件] 资料.pdf')
  assert.match(result.text, /小明: 你好/)
}
const cdataRecord = '<recordinfo><datalist><dataitem datatype="1"><sourcename>小明</sourcename><datadesc>原文 &amp; 内容</datadesc></dataitem></datalist></recordinfo>'
assert.equal(presentMessage(49, wrapRecord(`<![CDATA[${cdataRecord}]]>`), new Map()).forwarded.entries[0].text, '原文 & 内容')
assert.match(presentMessage(49, '<appmsg><title>聊天记录</title><type>19</type></appmsg>', new Map()).forwarded.unavailable, /未包含/)
console.log('合并转发解析自测通过：原始 XML、实体编码、CDATA、发送者、时间、文字、媒体占位和缺失正文。')

// WeChat stores merged forwards with the app subtype packed into the upper 32 bits.
const packedForward = presentMessage(81604378673, wrapRecord(`<![CDATA[${cdataRecord}]]>`), new Map())
assert.equal(packedForward.forwarded.entries.length, 1)
assert.equal(packedForward.forwarded.entries[0].text, '原文 & 内容')
console.log('微信实际合并转发消息类型 81604378673 解析通过。')

const systemTemplate = '<sysmsg type="sysmsgtemplate"><sysmsgtemplate><content_template><template><![CDATA[$inviter$邀请$names$加入了群聊]]></template><link_list><link name="inviter" type="link_profile"><memberlist><member><username>fixture_alice</username><nickname><![CDATA[小明 & 朋友]]></nickname></member></memberlist></link><link name="names" type="link_profile"><memberlist><member><nickname>小红</nickname></member><member><nickname>小蓝</nickname></member></memberlist></link></link_list></content_template></sysmsgtemplate></sysmsg>'
for (const type of [10000, 10002]) {
  assert.equal(presentMessage(type, systemTemplate, new Map()).text, '小明 & 朋友邀请小红、小蓝加入了群聊')
  assert.equal(presentMessage(type, '<sysmsg><template><![CDATA[$actor$拍了拍你]]></template><link name="actor"><title>小明</title></link></sysmsg>', new Map()).text, '小明拍了拍你')
  assert.equal(presentMessage(type, '<sysmsg><content><![CDATA[群公告：周五见 & 带好资料]]></content></sysmsg>', new Map()).text, '群公告：周五见 & 带好资料')
  assert.equal(presentMessage(type, '<?xml version="1.0"?><sysmsg><text>小明修改群名为&quot;周末小队&quot;</text></sysmsg>', new Map()).text, '小明修改群名为"周末小队"')
  assert.equal(presentMessage(type, '<sysmsg><unknown><username>fixture_private_id</username></unknown></sysmsg>', new Map()).text, '[系统消息]')
  assert.equal(presentMessage(type, '你邀请“小明”加入了群聊', new Map()).text, '你邀请“小明”加入了群聊')
  assert.equal(presentMessage(type, '群名已改为 <周末小队>', new Map()).text, '群名已改为 <周末小队>')
  assert.equal(presentMessage(type, '<sysmsg type="revokemsg"><revokemsg><newmsgid>123</newmsgid><replacemsg><![CDATA[小明撤回了一条消息]]></replacemsg></revokemsg></sysmsg>', new Map()).revoke.targetId, '123')
}
assert.equal(presentMessage(1, systemTemplate, new Map()).text, systemTemplate)
console.log('系统消息解析自测通过：进群模板、多人昵称、拍一拍、群公告、实体转义、未知结构及撤回兼容。')
