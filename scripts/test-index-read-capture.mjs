import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'
import { captureReadConversation, captureChatRecalls } from '../src/main/chat-recall-capture.ts'
import { emptyMonitor, saveMonitor, loadMonitor } from '../src/main/group-monitor.ts'
import { configureConversationCachePolicy, excludedConversations, saveExcludedConversations } from '../src/main/conversation-cache-policy.ts'
import { configureRecallMediaStore, retainMedia, readRetainedMedia, registerRecallMediaAccount } from '../src/main/recall-media-store.ts'
import { cacheImagePreview, readImagePreview } from '../src/main/image-preview-cache.ts'
const base=mkdtempSync(join(tmpdir(),'wetrace-index-capture-'))
try {
  const root=join(base,'fictional-account'),room='fixture@chatroom',key='fictional-secret',now=5000
  configureConversationCachePolicy(join(base,'policy'));configureRecallMediaStore(join(base,'media'))
  const data=Buffer.from('synthetic-image-content'),source=retainMedia(root,key,room,data,'image/png')
  const original={id:'1',serverId:'101',createdAt:1000,messageType:3,from:'me',text:'[图片]',time:'12:00',image:{source,thumbnail:false,hashes:['a'.repeat(32)]}}
  const conversation=messages=>({id:room,name:'测试群',type:'group',time:'',day:'',records:String(messages.length),range:'',preview:'',messages})
  let state=emptyMonitor(),releaseWrite,writeLane
  const fixture={createHash,join,registerRecallMediaAccount,retainMedia,cacheImagePreview,readImagePreview,excludedConversations,saveExcludedConversations,
    app:{getAppPath:()=>base,getPath:()=>base},
    utilityProcess:{fork:(_file,_args,options)=>{
      const child=new EventEmitter()
      child.postMessage=command=>{
        if(command.type==='init')return
        if(command.type==='index-conversation')queueMicrotask(()=>child.emit('message',{type:'result',id:command.id,result:structuredClone(conversation([original]))}))
        else if(command.type==='capture-read'){
          writeLane=options.serviceName
          releaseWrite=()=>{captureReadConversation(state,command.conversation,now);saveMonitor(join(base,'monitor'),root,key,state);child.emit('message',{type:'result',id:command.id,result:command.conversation})}
        } else throw new Error('unexpected command '+command.type)
      }
      return child
    }}}
  let sourceCode=stripTypeScriptTypes(readFileSync('src/main/wechat-background.ts','utf8'))
  sourceCode=sourceCode.replace(/^import \{([^}]+)\} from '[^']+';?$/gm,(_match,bindings)=>`const {${bindings}} = fixture`)
    .replace(/\bexport (?=(?:async )?function)/g,'')+'\nglobalThis.background={runIndexedConversation}'
  const context={fixture,Buffer,console,process:{resourcesPath:base},__dirname:base,setTimeout,clearTimeout}
  vm.runInNewContext(sourceCode,context)
  let settled=false
  const reading=context.background.runIndexedConversation({root,wxid:'fixture-self'},key,room).then(result=>{settled=true;return result})
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(settled,false,'捕获存盘完成之前，不把索引图片交给界面')
  assert.equal(typeof releaseWrite,'function')
  assert.equal(writeLane,'WeTrace 聊天读取','捕获写入必须经records通道，不在统计进程并发写')
  releaseWrite();const shown=await reading
  assert.equal(shown.messages[0].image.source,source)
  state=loadMonitor(join(base,'monitor'),root,key)
  assert.equal(state.rooms[0].checkedAt,undefined,'历史读取不推进实时水位')
  const notice={id:'2',createdAt:6000,messageType:10002,from:'me',text:'你撤回了一条消息',time:'12:01',revoke:{targetId:'101'}}
  const recalled=conversation([notice]);captureChatRecalls(state,recalled,6000)
  assert.equal(recalled.messages[0].recall.media.image.source,source,'索引图片已显示后撤回，应在对话中恢复图片')
  assert.deepEqual(readRetainedMedia(recalled.messages[0].recall.media.image.source).data,data)
  assert.equal(recalled.messages[0].revoke.unresolvedReason,undefined)
  assert.equal(state.events.length,0)
  // Database sync can deliver the recall before an in-flight history read reaches the writer.
  const reverse=emptyMonitor();captureChatRecalls(reverse,conversation([notice]),6000)
  const delayed=conversation([original]);captureReadConversation(reverse,delayed,7000)
  assert.equal(delayed.messages[0].recall.media.image.source,source,'撤回通知先到达也能关联稍后写入的原图片')
  const same=emptyMonitor(),sameNotice={...notice,id:'1',revoke:{}}
  captureChatRecalls(same,conversation([sameNotice]),6000)
  const delayedSame=conversation([original]);captureReadConversation(same,delayedSame,7000)
  assert.equal(delayedSame.messages[0].recall.media.image.source,source,'同一记录被替换时仍保留已读图片')
  const collision=emptyMonitor();captureChatRecalls(collision,conversation([{...notice,id:'1',serverId:'999',revoke:{targetId:'999'}}]),6000)
  captureReadConversation(collision,conversation([original]),7000)
  assert.equal(collision.rooms[0].messages[0].type,10002,'冲突目标不能仅按本地编号覆盖通知')
  assert.equal(collision.rooms[0].messages[0].media?.image,undefined)
  console.log('索引图片防撤回通过：实际后台调度、先存盘后返回、统计/记录通道隔离、已显示图片撤回恢复、重启、通知先到、同ID替换与冲突拒绝。')
} finally {rmSync(base,{recursive:true,force:true})}
