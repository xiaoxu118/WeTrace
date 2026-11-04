import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ScheduledMessages } from '../src/main/scheduled-messages.ts'
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wetrace-send-'))
let now=1000, calls=0, supported=true, uncertain=false
const transport={capability:async()=>({supported,reason:supported?undefined:'版本不支持'}),recipients:async()=>[{id:'fictional-recipient',name:'虚构接收方'}],send:async(root,task)=>{calls++;if(uncertain)throw new Error('lost response');return {taskId:task.id,recipientId:task.recipientId,receipt:'synthetic-delivery-receipt'}}}
// Reversible test cipher; production injects Electron safeStorage instead.
const encode=text=>Buffer.from(text).map(byte=>byte^0x55),decode=bytes=>Buffer.from(bytes).map(byte=>byte^0x55).toString()
let scheduler=new ScheduledMessages(directory,transport,encode,decode,()=>now)
const root='/fictional/account'
try {
 assert.equal((await scheduler.update(root,{type:'load'})).state.enabled,false)
 const create=async()=>{const {state}=await scheduler.update(root,{type:'create',recipientId:'fictional-recipient',content:'虚构待发送内容',dueAt:now+1000});return state.tasks[0].id}
 const draft=await create()
 now+=2000;await scheduler.tick(root);assert.equal(calls,0,'默认关闭且未确认不会发送')
 supported=false
 await assert.rejects(scheduler.update(root,{type:'enable',enabled:true}),/版本不支持/)
 supported=true
 await scheduler.update(root,{type:'enable',enabled:true})
 const id=await create()
 await scheduler.update(root,{type:'confirm',id})
 await scheduler.update(root,{type:'pause',id})
 now+=500;await scheduler.tick(root);assert.equal(calls,0)
 await scheduler.update(root,{type:'resume',id})
 now+=600
 await Promise.all([scheduler.tick(root),scheduler.tick(root)])
 assert.equal(calls,1)
 assert.equal((await scheduler.update(root,{type:'load'})).state.tasks.find(task=>task.id===id).status,'sent')
 await scheduler.tick(root);assert.equal(calls,1,'已发送不能重复执行')
 const cancelled=await create();await scheduler.update(root,{type:'confirm',id:cancelled});await scheduler.update(root,{type:'cancel',id:cancelled});now+=2000;await scheduler.tick(root);assert.equal(calls,1)
 const unknown=await create();await scheduler.update(root,{type:'confirm',id:unknown});uncertain=true;now+=2000;await scheduler.tick(root);await scheduler.tick(root);assert.equal(calls,2)
 assert.equal((await scheduler.update(root,{type:'load'})).state.tasks.find(task=>task.id===unknown).status,'unknown')
 const paused=await create();await scheduler.update(root,{type:'confirm',id:paused});await scheduler.update(root,{type:'enable',enabled:false})
 assert.equal((await scheduler.update(root,{type:'load'})).state.tasks.find(task=>task.id===paused).status,'paused')
 scheduler=new ScheduledMessages(directory,transport,encode,decode,()=>now)
 assert.equal((await scheduler.update(root,{type:'load'})).state.tasks.find(task=>task.id===id).status,'sent')
 assert.equal((await scheduler.update('/fictional/other',{type:'load'})).state.tasks.length,0)
 assert.ok(fs.readdirSync(directory).every(file=>!fs.readFileSync(path.join(directory,file)).includes(Buffer.from('虚构待发送内容'))))
 await assert.rejects(scheduler.update(root,{type:'confirm',id:draft}),/开启|失效/)
 await scheduler.update(root,{type:'enable',enabled:true})
 const late=await create();await scheduler.update(root,{type:'confirm',id:late});now+=3600000;const beforeLate=calls;await scheduler.tick(root)
 assert.equal(calls,beforeLate)
 assert.equal((await scheduler.update(root,{type:'load'})).state.tasks.find(task=>task.id===late).status,'paused')
 const unsupported=await create();await scheduler.update(root,{type:'confirm',id:unsupported});supported=false;now+=1100;await scheduler.tick(root)
 assert.equal(calls,beforeLate)
 assert.equal((await scheduler.update(root,{type:'load'})).state.tasks.find(task=>task.id===unsupported).status,'failed')
 supported=true
 // Persist an in-flight crash fixture, then recreate the scheduler: never re-dispatch it.
 const fixtureFile=fs.readdirSync(directory).find(file=>decode(fs.readFileSync(path.join(directory,file))).includes('虚构待发送内容'))
 const persisted=JSON.parse(decode(fs.readFileSync(path.join(directory,fixtureFile))))
 persisted.tasks.find(task=>task.id===unsupported).status='sending'
 fs.writeFileSync(path.join(directory,fixtureFile),encode(JSON.stringify(persisted)))
 scheduler=new ScheduledMessages(directory,transport,encode,decode,()=>now)
 assert.equal((await scheduler.update(root,{type:'load'})).state.tasks.find(task=>task.id===unsupported).status,'unknown')
 await scheduler.tick(root);assert.equal(calls,beforeLate)
 console.log('定时发送调度测试通过：默认关闭、明确确认、暂停继续、取消、账号隔离、加密落盘、并发去重、未知结果不重试')
}finally{scheduler.stop();fs.rmSync(directory,{recursive:true,force:true})}
