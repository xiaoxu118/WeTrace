import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { refreshOriginalImage } from '../src/main/recall-original-image.ts'
import { configureRecallMediaStore, readRetainedMedia } from '../src/main/recall-media-store.ts'
import { configureConversationCachePolicy } from '../src/main/conversation-cache-policy.ts'
import { presentMessage, localImages } from '../src/main/message-content.ts'
import { emptyMonitor, loadMonitor, saveMonitor } from '../src/main/group-monitor.ts'
import { captureChatRecalls } from '../src/main/chat-recall-capture.ts'
import { retainedRecallMessages } from '../src/shared/retained-recalls.ts'
const base=mkdtempSync(join(tmpdir(),'wetrace-original-recall-'))
try {
  const root=join(base,'fixture-account'),room='fixture@chatroom',key='fixture-secret',hash='a'.repeat(32)
  configureConversationCachePolicy(join(base,'policy'));configureRecallMediaStore(join(base,'media'))
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=','base64')
  const folder=join(root,'msg/attach',createHash('md5').update(room).digest('hex'),'2026-11','Img')
  mkdirSync(folder,{recursive:true});writeFileSync(join(folder,hash+'_t.dat'),png)
  const parsed=presentMessage(3,`<img md5="${hash}"/>`,localImages(root,room))
  assert.deepEqual(parsed.image.hashes,[hash]);assert.equal(parsed.image.thumbnail,true)
  const original={id:'original',serverId:'100',createdAt:1000,messageType:3,from:'them',time:'12:00',...parsed}
  const state=emptyMonitor(),conversation=messages=>({id:room,name:'测试群',type:'group',messages})
  captureChatRecalls(state,conversation([original]),1000)
  const notice={id:'notice',createdAt:2000,messageType:10002,from:'them',text:'撤回',time:'12:01',revoke:{targetId:'100'}}
  captureChatRecalls(state,conversation([notice]),2000)
  saveMonitor(join(base,'monitor'),root,key,state)
  const reloaded=loadMonitor(join(base,'monitor'),root,key)
  const captured=reloaded.rooms[0].messages.find(message=>message.id==='original')
  assert.deepEqual(captured.media.image.hashes,[hash],'撤回且重启后保留原图片哈希')
  assert.equal(refreshOriginalImage(root,key,room,captured.media.image).thumbnail,true,'只有缩略图时不冒充原图')
  const full=Buffer.concat([png,Buffer.from('fictional-original-content')])
  writeFileSync(join(folder,hash+'_hd.dat'),full)
  writeFileSync(join(folder,hash+'_m.dat'),Buffer.concat([full,Buffer.alloc(1024)]))
  const image=refreshOriginalImage(root,key,room,captured.media.image)
  assert.equal(image.thumbnail,false)
  assert.match(image.source,/^wetrace-media:\/\/retained\//)
  assert.deepEqual(readRetainedMedia(image.source).data,full,'原消息已撤回后仍按哈希获取并加密保存原图')
  const aliasDir=join(root,'msg/attach','native-mapping','2026-11','Img');mkdirSync(aliasDir,{recursive:true})
  const alias=join(aliasDir,'b'.repeat(32)+'_hd.dat');writeFileSync(alias,full)
  const mapped=refreshOriginalImage(root,key,room,{hashes:['c'.repeat(32)],thumbnail:true},()=>alias)
  assert.equal(mapped.thumbnail,false,'支持hardlink实际路径与文件名不等于消息hash的情况')
  const outside=join(base,'outside.png');writeFileSync(outside,full)
  assert.equal(refreshOriginalImage(root,key,room,{hashes:['d'.repeat(32)],thumbnail:true},()=>outside).source,undefined,'原图路径不能越过当前账号目录')
  assert.throws(()=>refreshOriginalImage(root,key,room,{source:'legacy-thumbnail',thumbnail:true}),/未保存原图定位信息/)
  rmSync(folder,{recursive:true,force:true})
  assert.equal(refreshOriginalImage(root,key,room,image).source,image.source,'已保留原图不再依赖微信原文件')
  console.log('撤回原图恢复通过：缩略图不冒充原图、定位信息持久化、撤回后获取原图、hardlink映射、越界拒绝及旧缓存缺失提示。')
} finally {rmSync(base,{recursive:true,force:true})}
