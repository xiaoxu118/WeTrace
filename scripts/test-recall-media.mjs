import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureRecallMediaStore, registerRecallMediaAccount, retainMedia, readRetainedMedia, retainedMediaResponse, excludeRecallMedia } from '../src/main/recall-media-store.ts'
import { configureConversationCachePolicy, saveExcludedConversations } from '../src/main/conversation-cache-policy.ts'
import { readLocalVideo, videoHashes } from '../src/main/local-video.ts'
import { emptyMonitor, observeRoom, saveMonitor, loadMonitor } from '../src/main/group-monitor.ts'
import { captureChatRecalls } from '../src/main/chat-recall-capture.ts'
const base = mkdtempSync(join(tmpdir(), 'wetrace-recall-media-'))
try {
  configureConversationCachePolicy(join(base, 'policy'))
  configureRecallMediaStore(join(base, 'media'))
  const root = join(base, 'fictional-account'), room = 'fixture@chatroom', key = 'fixture-secret'
  const image = Buffer.alloc(2 * 1024 * 1024, 17)
  const source = retainMedia(root, key, room, image, 'image/png')
  assert.deepEqual(readRetainedMedia(source).data, image, '超过旧1MiB限制的图片可保留')
  assert.equal(retainMedia(root, key, room, image, 'image/png'), source)
  const box = (name, data = Buffer.alloc(0)) => { const header=Buffer.alloc(8);header.writeUInt32BE(8+data.length);header.write(name,4);return Buffer.concat([header,data]) }
  const video = Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('mdat', Buffer.from('fictional-video-content')), box('moov')])
  const hash = 'a'.repeat(32), videoDir = join(root, 'msg/video', '2026-11')
  mkdirSync(videoDir, {recursive:true}); writeFileSync(join(videoDir, hash+'.mp4'), video)
  assert.deepEqual(readLocalVideo(root, room, `<msg><videomsg md5="${hash}" /></msg>`), video)
  const alias = 'b'.repeat(32)
  writeFileSync(join(videoDir, alias+'.mp4'), video)
  const seen=[]
  assert.deepEqual(readLocalVideo(root, room, `<videomsg md5="${'c'.repeat(32)}" />`, undefined, value => {seen.push(value);return alias}), video, '通过hardlink表把消息MD5映射到实际视频名')
  assert.deepEqual(seen,['c'.repeat(32)])
  assert.deepEqual(readLocalVideo(root, room, `<videomsg md5="${'c'.repeat(32)}" />`, undefined, () => alias+'.mp4'), video, '映射已包含扩展名时直接使用')
  assert.deepEqual(videoHashes(`<videomsg md5="${hash}" rawmd5="${alias}" cdnthumbmd5="${'d'.repeat(32)}"/>`, 'e'.repeat(32)),[hash,alias,'e'.repeat(32)], '原视频hash候选不包含封面hash')
  assert.deepEqual(readLocalVideo(root, room, `<videomsg md5="${'c'.repeat(32)}" rawmd5="${alias}"/>`),video)
  writeFileSync(join(base,'outside.mp4'),video)
  assert.equal(readLocalVideo(root, room, `<videomsg md5="${'c'.repeat(32)}"/>`,undefined,()=>join(base,'outside.mp4')),undefined,'拒绝映射表中的绝对路径')
  assert.equal(readLocalVideo(root, room, `<videomsg md5="${'c'.repeat(32)}"/>`,undefined,()=> '../outside.mp4'),undefined,'拒绝路径穿越')
  assert.deepEqual(readLocalVideo(root, room, `<videomsg md5="${hash}"/>`,undefined,()=>{throw new Error('模拟桥接不可用')}),video,'桥接失败仍按hash读取')

  writeFileSync(join(videoDir, hash+'.mp4'), video.subarray(0, video.length-1))
  assert.equal(readLocalVideo(root, room, `<videomsg md5="${hash}" />`), undefined, '下载未完成时不保留损坏视频')
  assert.equal(readLocalVideo(root, room, '<videomsg md5="../../secret" />'), undefined)
  const videoSource = retainMedia(root,key,room,video,'video/mp4')
  const partial = retainedMediaResponse(videoSource, 'bytes=4-11')
  assert.equal(partial.status,206);assert.deepEqual(Buffer.from(await partial.arrayBuffer()),video.subarray(4,12))
  assert.equal(retainedMediaResponse(videoSource,'bytes=999999-').status,416)
  assert.deepEqual(Buffer.from(await retainedMediaResponse(videoSource, 'bytes=-4').arrayBuffer()),video.subarray(-4))
  const state = emptyMonitor(), conversation = messages => ({id:room,name:'测试群',type:'group',messages})
  const original = {id:'1',serverId:'100',createdAt:1000,messageType:3,from:'them',sender:'成员甲',text:'[图片]',image:{source},time:'12:00'}
  captureChatRecalls(state,conversation([original]),1000)
  captureChatRecalls(state,conversation([{...original,image:{unavailable:'模拟读取失败'}}]),2000)
  assert.equal(state.rooms[0].messages[0].media.image.source,source)
  const videoMessage = {...original,id:'2',serverId:'200',messageType:43,text:'[视频]',image:undefined,video:{source:videoSource}}
  captureChatRecalls(state,conversation([videoMessage]),3000)
  captureChatRecalls(state,conversation([{...videoMessage,video:{unavailable:'暂未下载'}}]),4000)
  assert.equal(state.rooms[0].messages[1].media.video.source,videoSource)
  saveMonitor(join(base,'monitor'),root,key,state)
  const reloaded=loadMonitor(join(base,'monitor'),root,key)
  const recalled=conversation([{...videoMessage,messageType:10002,text:'成员甲撤回了一条消息',revoke:{targetId:'200'},video:undefined}])
  captureChatRecalls(reloaded,recalled,5000)
  assert.equal(recalled.messages[0].recall.media.video.source,videoSource)
  registerRecallMediaAccount(root,'wrong-key');assert.equal(readRetainedMedia(source),undefined)
  registerRecallMediaAccount(root,key);assert.deepEqual(readRetainedMedia(source).data,image)
  const accountDir = join(base,'media', new URL(source).pathname.split('/')[1])
  for(const folder of readdirSync(accountDir)) for(const file of readdirSync(join(accountDir,folder))) assert.equal(readFileSync(join(accountDir,folder,file)).includes(Buffer.from('fictional-video-content')),false)
  saveExcludedConversations(root,[room]);assert.equal(readRetainedMedia(source),undefined)
  assert.equal(retainMedia(root,key,room,image,'image/png'),undefined)
  excludeRecallMedia(root,[room]);saveExcludedConversations(root,[]);assert.equal(readRetainedMedia(source),undefined)
  console.log('撤回媒体测试通过：加密副本、大图、完整视频、断点播放、失败不覆盖、重启恢复、密钥和会话隔离、排除清理。')
} finally {rmSync(base,{recursive:true,force:true})}
