import assert from 'node:assert/strict'
import { queryAiEvidence } from '../src/main/ai-evidence.ts'
const source = Array.from({length:120000},(_,i)=>({id:String(i),from:'them',sender:i%2?'成员甲':'成员乙',text:i%3?'普通消息':'指定原话'+i,createdAt:1793347200000,messageType:1,time:'12:00'}))
const input={root:'/fictional/account',state:{conversationId:'fictional@chatroom',startDate:'2026-10-01',endDate:'2026-10-31'},keyword:'指定原话',page:1}
let called=0
const read=async query=>{called++;assert.equal(query.root,input.root);assert.equal(query.conversationId,input.state.conversationId);assert.equal(query.startDate,input.state.startDate);assert.equal(query.deferMedia,true);return {messages:source}}
const first=await queryAiEvidence(input,read)
const second=await queryAiEvidence({...input,page:2},read)
assert.equal(first.total,40000)
assert.equal(first.messages.length,50)
assert.equal(first.messages[0].id,'0')
assert.equal(second.messages[0].id,'150')
assert.equal(first.messages.some(message=>second.messages.includes(message)),false)
assert.equal((await queryAiEvidence({...input,keyword:'成员甲'},read)).total,60000)
assert.deepEqual(await queryAiEvidence({...input,keyword:'没有对应记录'},read),{messages:[],total:0})
for(const invalid of [{page:0},{page:1.5},{keyword:'x'.repeat(501)},{state:{...input.state,startDate:'2026-02-30'}},{state:{...input.state,startDate:'2026-11-01'}}]) {
 const before=called
 await assert.rejects(queryAiEvidence({...input,...invalid},read))
 assert.equal(called,before,'无效请求不能读取源记录')
}
console.log('AI原文回查通过：12万条虚构记录、主进程检索分页、日期与账号范围、无效输入不读取源数据')
