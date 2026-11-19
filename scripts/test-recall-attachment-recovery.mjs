import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recoverCapturedAttachments } from '../src/main/recall-attachment-recovery.ts'
import { watchWechatMedia } from '../src/main/wechat-media-watch.ts'
import { configureConversationCachePolicy, saveExcludedConversations } from '../src/main/conversation-cache-policy.ts'
import { configureRecallMediaStore, readRetainedMedia } from '../src/main/recall-media-store.ts'
import { captureChatRecalls } from '../src/main/chat-recall-capture.ts'
import { emptyMonitor } from '../src/main/group-monitor.ts'
import { retainedRecallMessages } from '../src/shared/retained-recalls.ts'
const base=mkdtempSync(join(tmpdir(),'wetrace-late-attachment-'))
let watcher
try {
  configureConversationCachePolicy(join(base,'policy'));configureRecallMediaStore(join(base,'media'))
  const root=join(base,'fictional-account'),room='fixture@chatroom',key='fictional-secret'
  mkdirSync(root,{recursive:true})
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=','base64')
  const file={name:'延迟附件.PNG',md5:createHash('md5').update(png).digest('hex'),size:png.length,unavailable:'未留存文件内容'}
  const original={id:'1',serverId:'101',messageType:49,createdAt:1000,from:'them',text:file.name,time:'12:00',file}
  const state=emptyMonitor(),conversation=messages=>({id:room,name:'测试群',type:'group',messages})
  captureChatRecalls(state,conversation([original]),1000)
  const notice={id:'2',createdAt:2000,messageType:10002,from:'them',text:'撤回',time:'12:01',revoke:{targetId:'101'}}
  captureChatRecalls(state,conversation([notice]),2000)
  recoverCapturedAttachments(state,root,key)
  assert.equal(state.rooms[0].messages[0].media.file.source,undefined)
  let changes=0
  watcher=watchWechatMedia(root,()=>changes++)
  const until=async predicate=>{for(let i=0;i<80;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error('附件监听超时')}
  const folder=join(root,'msg/attach',createHash('md5').update(room).digest('hex'),'2026-11','File')
  mkdirSync(folder,{recursive:true})
  await until(()=>changes>0)
  await new Promise(resolve=>setTimeout(resolve,100))
  const beforeWrite=changes
  writeFileSync(join(folder,file.name),png)
  await until(()=>changes>beforeWrite)
  const before=JSON.stringify({checkedAt:state.rooms[0].checkedAt,events:state.events})
  recoverCapturedAttachments(state,root,key)
  const recovered=retainedRecallMessages([notice],state.rooms[0])[0]
  assert.ok(recovered.recall.media.file.source,'数据库原记录撤回后仍可按已保存附件元数据补取本机文件')
  assert.deepEqual(readRetainedMedia(recovered.recall.media.file.source).data,png)
  assert.equal(recovered.recall.media.image.thumbnail,false)
  assert.equal(JSON.stringify({checkedAt:state.rooms[0].checkedAt,events:state.events}),before,'补取附件不改变捕获水位或生成重复事件')
  const box=(name,data=Buffer.alloc(0))=>{const header=Buffer.alloc(8);header.writeUInt32BE(data.length+8);header.write(name,4);return Buffer.concat([header,data])}
  const video=Buffer.concat([box('ftyp',Buffer.from('isom0000')),box('mdat',Buffer.from('fictional-video')),box('moov')])
  const videoHash='f'.repeat(32),resolved='e'.repeat(32)
  const videoOriginal={id:'v1',serverId:'201',createdAt:3000,messageType:43,from:'them',text:'[视频]',time:'12:02',video:{hashes:[videoHash],unavailable:'尚未下载'}}
  captureChatRecalls(state,conversation([videoOriginal]),3000)
  const videoNotice={id:'v2',createdAt:4000,messageType:10002,from:'them',text:'撤回',time:'12:03',revoke:{targetId:'201'}}
  captureChatRecalls(state,conversation([videoNotice]),4000)
  const videoDir=join(root,'msg/video','2026-11');mkdirSync(videoDir,{recursive:true})
  writeFileSync(join(videoDir,resolved+'.mp4'),video.subarray(0,video.length-1))
  recoverCapturedAttachments(state,root,key,hash=>hash===videoHash?resolved:undefined)
  assert.equal(state.rooms[0].messages.find(message=>message.id==='v1').media.video.source,undefined,'未完成的视频不能标记已保留')
  writeFileSync(join(videoDir,resolved+'.mp4'),video)
  recoverCapturedAttachments(state,root,key,hash=>hash===videoHash?resolved:undefined)
  const videoRecalled=retainedRecallMessages([videoNotice],state.rooms[0])[0]
  assert.deepEqual(readRetainedMedia(videoRecalled.recall.media.video.source).data,video,'普通视频撤回后仍按已存哈希及实际文件名补存')
  const fileVideo={name:'延迟视频附件.mp4',md5:createHash('md5').update(video).digest('hex'),size:video.length}
  const fileOriginal={id:'vf1',serverId:'301',createdAt:5000,messageType:49,from:'them',text:fileVideo.name,time:'12:04',file:fileVideo}
  captureChatRecalls(state,conversation([fileOriginal]),5000)
  const fileNotice={id:'vf2',createdAt:6000,messageType:10002,from:'them',text:'撤回',time:'12:05',revoke:{targetId:'301'}}
  captureChatRecalls(state,conversation([fileNotice]),6000)
  writeFileSync(join(folder,fileVideo.name),video)
  recoverCapturedAttachments(state,root,key)
  const fileRecalled=retainedRecallMessages([fileNotice],state.rooms[0])[0]
  assert.equal(fileRecalled.recall.media.file.source,fileRecalled.recall.media.video.source,'文件型MP4同时支持播放和另存为')
  assert.deepEqual(readRetainedMedia(fileRecalled.recall.media.video.source).data,video)
  saveExcludedConversations(root,[room])
  const excluded=structuredClone(state);delete excluded.rooms[0].messages[0].media.file.source;delete excluded.rooms[0].messages[0].media.image
  recoverCapturedAttachments(excluded,root,key)
  assert.equal(excluded.rooms[0].messages[0].media.file.source,undefined)
  watcher.close();const stopped=changes
  writeFileSync(join(folder,'after-stop.txt'),'fictional content')
  await new Promise(resolve=>setTimeout(resolve,150))
  assert.equal(changes,stopped,'取消账号监听后不再触发附件同步')
  console.log('附件防撤回补取通过：延迟下载、数据库原文已替换、图片与视频内容恢复、文件型视频播放、不改水位、缓存排除、附件目录自动监听与取消。')
} finally {watcher?.close();rmSync(base,{recursive:true,force:true})}
