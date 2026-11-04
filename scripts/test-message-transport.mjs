// Execute a tiny local fixture program; never launches WeChat or sends a message.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { NativeMessageTransport } from '../src/main/message-transport.ts'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'wetrace-transport-'))
const directory=path.join(root,process.platform,process.arch)
fs.mkdirSync(directory,{recursive:true})
const executable=path.join(directory,process.platform==='win32'?'sender.exe':'sender')
let version='4.1.13.1'
const transport=new NativeMessageTransport(root,async()=>version,async()=>[])
const task={id:'fictional-task',recipientId:'fictional-recipient',recipientName:'虚构对象',content:'虚构内容',dueAt:1,status:'scheduled',createdAt:1,updatedAt:1,logs:[]}
try {
 assert.equal((await transport.capability('/fictional')).supported,false)
 if(process.platform!=='win32'){
  const program='#!/usr/bin/env node\nlet text="";process.stdin.setEncoding("utf8");process.stdin.on("data",chunk=>text+=chunk);process.stdin.on("end",()=>{const input=JSON.parse(text);console.log(JSON.stringify({taskId:input.taskId,recipientId:input.recipientId,receipt:"仅测试回执"}))})\n'
  fs.writeFileSync(executable,program,{mode:0o700})
  fs.writeFileSync(path.join(directory,'compatibility.json'),JSON.stringify({protocol:1,versions:[version],sha256:createHash('sha256').update(program).digest('hex')}))
  assert.equal((await transport.capability('/fictional')).supported,true)
  assert.equal((await transport.send('/fictional',task,new AbortController().signal)).receipt,'仅测试回执')
  const controller=new AbortController();controller.abort();await assert.rejects(transport.send('/fictional',task,controller.signal))
  version='4.2.0';assert.equal((await transport.capability('/fictional')).supported,false)
  version='4.1.13.1';fs.appendFileSync(executable,'\n// modified');assert.equal((await transport.capability('/fictional')).supported,false)
 }
 console.log('发送通道协议测试通过：缺失组件、完整版本匹配、SHA-256校验、JSON请求/回执与取消；仅执行本地虚构程序')
}finally{fs.rmSync(root,{recursive:true,force:true})}
