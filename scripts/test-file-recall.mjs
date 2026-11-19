import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { presentMessage } from '../src/main/message-content.ts'
import { readLocalAttachment } from '../src/main/local-attachment.ts'
import { configureRecallMediaStore, retainMedia, readRetainedMedia, retainedMediaResponse } from '../src/main/recall-media-store.ts'
import { configureConversationCachePolicy } from '../src/main/conversation-cache-policy.ts'
import { captureChatRecalls } from '../src/main/chat-recall-capture.ts'
import { emptyMonitor, loadMonitor, saveMonitor } from '../src/main/group-monitor.ts'
const base=mkdtempSync(join(tmpdir(),'wetrace-file-recall-'))
try {
  const root=join(base,'fictional-account'),room='fixture@chatroom',key='fictional-secret'
  configureConversationCachePolicy(join(base,'policy'));configureRecallMediaStore(join(base,'media'))
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=','base64')
  const hash=createHash('md5').update(png).digest('hex')
  const xml=`<msg><appmsg><title>示例附件.PNG</title><type>6</type><url>https://example.com/not-a-file</url><appattach><totallen>${png.length}</totallen><md5>${hash}</md5></appattach></appmsg></msg>`
  const parsed=presentMessage(49,xml,new Map())
  assert.deepEqual(parsed.file,{name:'示例附件.PNG',size:png.length,md5:hash});assert.equal(parsed.link,undefined,'文件附件不能误解析成链接')
  const folder=join(root,'msg/attach',createHash('md5').update(room).digest('hex'),'2026-11','File')
  mkdirSync(folder,{recursive:true});writeFileSync(join(folder,parsed.file.name),png)
  const found=readLocalAttachment(root,room,parsed.file)
  assert.deepEqual(found,{data:png,mime:'image/png'})
  assert.equal(readLocalAttachment(root,'other@chatroom',parsed.file),undefined,'不读取其他会话中的同名附件')
  assert.equal(readLocalAttachment(root,room,{...parsed.file,md5:'a'.repeat(32)}),undefined,'摘要不一致不能冒充已留存原文件')
  assert.equal(readLocalAttachment(root,room,{...parsed.file,size:png.length+1}),undefined,'拒绝未完成的文件')
  assert.equal(readLocalAttachment(root,room,{...parsed.file,name:'../secret.PNG'}),undefined)
  const source=retainMedia(root,key,room,found.data,found.mime)
  const original={id:'1',serverId:'101',createdAt:1000,messageType:49,from:'them',text:parsed.text,time:'12:00',file:{...parsed.file,source},image:{source,thumbnail:false}}
  const state=emptyMonitor(),conversation=messages=>({id:room,name:'测试群',type:'group',messages})
  captureChatRecalls(state,conversation([original]),1000)
  captureChatRecalls(state,conversation([{...original,file:{...parsed.file,unavailable:'文件不在本机'},image:undefined}]),2000)
  assert.equal(state.rooms[0].messages[0].media.file.source,source,'后续读取失败不覆盖成功副本')
  saveMonitor(join(base,'monitor'),root,key,state)
  rmSync(folder,{recursive:true,force:true})
  const reloaded=loadMonitor(join(base,'monitor'),root,key)
  const recalled=conversation([{id:'2',createdAt:3000,messageType:10002,from:'them',text:'撤回',time:'12:01',revoke:{targetId:'101'}}])
  captureChatRecalls(reloaded,recalled,3000)
  assert.equal(recalled.messages[0].recall.originalType,49)
  assert.equal(recalled.messages[0].recall.media.file.source,source)
  assert.deepEqual(readRetainedMedia(source).data,png,'原附件删除并重新加载后仍保留文件内容')
  const document=Buffer.from('fictional document data'),documentSource=retainMedia(root,key,room,document,'application/octet-stream')
  assert.deepEqual(Buffer.from(await retainedMediaResponse(documentSource).arrayBuffer()),document)
  assert.equal(retainedMediaResponse(documentSource).headers.get('Content-Disposition'),'attachment','通用附件不能作为页面执行')
  // Filename alone is not sufficient outside a conversation-scoped directory.
  const global=join(root,'msg/file','2026-11');mkdirSync(global,{recursive:true});writeFileSync(join(global,'示例附件.PNG'),png)
  assert.equal(readLocalAttachment(root,room,{name:'示例附件.PNG',size:png.length}),undefined)
  assert.deepEqual(readLocalAttachment(root,room,parsed.file).data,png,'账号公共文件目录必须通过内容摘要确认')
  const duplicate1=join(folder,'one'),duplicate2=join(folder,'two');mkdirSync(duplicate1,{recursive:true});mkdirSync(duplicate2,{recursive:true})
  for(const directory of [duplicate1,duplicate2])writeFileSync(join(directory,'same.bin'),document)
  assert.equal(readLocalAttachment(root,room,{name:'same.bin',size:document.length}),undefined,'无摘要的重名附件不猜测关联')
  console.log('文件撤回测试通过：文件型PNG解析、内容校验、会话隔离、加密留存、删除及重载恢复、通用附件、失败不覆盖和重名保护。')
} finally {rmSync(base,{recursive:true,force:true})}
