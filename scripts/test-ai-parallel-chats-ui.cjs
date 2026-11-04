// Paused model fixtures make overlap, reversed completion and cancellation deterministic.
const {app,BrowserWindow}=require('electron')
const fs=require('node:fs/promises')
const path=require('node:path')
const assert=require('node:assert/strict')
app.on('window-all-closed',()=>{})
app.whenReady().then(async()=>{
 const reference=await fs.readFile(path.resolve('scripts/test-report-ui.cjs'),'utf8')
 const marker='await fs.writeFile(preload, `',begin=reference.indexOf(marker)+marker.length
 const source=reference.slice(begin,reference.indexOf('\n`)',begin)).replace("contextBridge.exposeInMainWorld('wetrace', api)",`
 let delta=()=>{},progress=()=>{};const requests=[],pending=new Map(),cancelled=[]
 api.onAiDelta=callback=>{delta=callback;return()=>{}}
 api.onAiProgress=callback=>{progress=callback;return()=>{}}
 api.askAi=input=>new Promise(resolve=>{requests.push(input);pending.set(input.requestId,{input,resolve});progress({requestId:input.requestId,detail:'处理中'+input.turns.at(-1).content});delta({requestId:input.requestId,text:'片段'+input.turns.at(-1).content})})
 api.parallelStats=()=>({requests,cancelled})
 api.parallelHistory=()=>aiHistories.get('/test')?.archive
 api.emitFixture=chatId=>{const job=[...pending.values()].find(job=>job.input.chatId===chatId);delta({requestId:job.input.requestId,text:'甲的额外内容'});progress({requestId:job.input.requestId,detail:'甲正在压缩'})}
 api.completeFixture=chatId=>{const entry=[...pending.entries()].find(([,job])=>job.input.chatId===chatId);const [id,job]=entry;pending.delete(id);job.resolve({ok:true,answer:'回答'+job.input.turns.at(-1).content,memory:{version:1,scope:'fixture',summary:'记忆'+job.input.turns.at(-1).content,coveredTurns:0,prefixHash:'fixture'}})}
 api.cancelAi=async requestId=>{cancelled.push(requestId);const job=pending.get(requestId);if(job){pending.delete(requestId);job.resolve({ok:false,error:'已停止生成'})}}
 contextBridge.exposeInMainWorld('wetrace', api)
 `)
 const preload=path.resolve('.cache/ai-parallel-chats-ui-preload.cjs')
 await fs.mkdir(path.dirname(preload),{recursive:true});await fs.writeFile(preload,source)
 const window=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload,sandbox:false,offscreen:true,partition:'ai-parallel-'+Date.now()}})
 const run=code=>window.webContents.executeJavaScript(code)
 const until=async code=>{for(let i=0;i<100;i++){if(await run(code))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('UI timeout '+code)}
 const send=async text=>{
  await run(`(()=>{const input=document.querySelector('[aria-label="向 AI 提问"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await until(`!!document.querySelector('[aria-label="发送消息"]')&&!document.querySelector('[aria-label="发送消息"]').disabled`)
  await run(`document.querySelector('[aria-label="发送消息"]').click()`)
 }
 try {
  await window.loadFile(path.resolve('out/renderer/index.html'))
  await until(`!!document.querySelector('.conv-list')`)
  await run(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='AI 对话').click()`)
  await until(`!!document.querySelector('.ai-new-chat')&&!document.querySelector('.ai-new-chat').disabled`)
  await send('问题甲')
  await until(`window.wetrace.parallelStats().requests.length===1`)
  assert.equal(await run(`document.querySelector('[aria-label="正在整理回答"]').disabled`),true)
  await run(`document.querySelector('.ai-new-chat').click()`)
  await until(`!!document.querySelector('.ai-welcome')`)
  assert.equal(await run(`document.querySelector('[aria-label="对话模型"]').disabled`),false)
  await send('问题乙')
  await until(`window.wetrace.parallelStats().requests.length===2`)
  const {requests}=await run('window.wetrace.parallelStats()')
  assert.notEqual(requests[0].chatId,requests[1].chatId)
  await run(`window.wetrace.emitFixture(${JSON.stringify(requests[0].chatId)})`)
  assert.ok(await run(`document.querySelector('.ai-messages').textContent.includes('片段问题乙')`))
  assert.equal(await run(`document.querySelector('.ai-messages').textContent.includes('甲的额外内容')`),false)
  await run(`window.wetrace.completeFixture(${JSON.stringify(requests[1].chatId)})`)
  await until(`document.querySelector('.ai-messages').textContent.includes('回答问题乙')&&!document.querySelector('.ai-working')`)
  await run(`Array.from(document.querySelectorAll('.ai-history-open')).find(button=>button.textContent==='问题甲').click()`)
  await until(`document.querySelector('.ai-working')?.textContent.includes('甲正在压缩')`)
  assert.equal(await run(`document.querySelector('.ai-messages').textContent.includes('回答问题乙')`),false)
  await run(`document.querySelector('[aria-label="停止生成"]').click()`)
  await until(`document.querySelector('.ai-request-error')?.textContent.includes('已停止生成')`)
  assert.deepEqual((await run('window.wetrace.parallelStats()')).cancelled,[requests[0].requestId])
  await until(`window.wetrace.parallelHistory()?.chats.find(chat=>chat.title==='问题乙')?.memory?.summary==='记忆问题乙'`)
  const saved=await run('window.wetrace.parallelHistory()')
  assert.ok(saved.chats.find(chat=>chat.title==='问题甲').turns.at(-1).content.includes('甲的额外内容'))
  assert.equal(saved.chats.find(chat=>chat.title==='问题乙').turns.at(-1).content,'回答问题乙')
  assert.equal(saved.chats.find(chat=>chat.title==='问题甲').turns.some(turn=>turn.content.includes('问题乙')),false)
  console.log('AI多对话UI：生成中新建并发送、流式与进度隔离、逆序完成、单独取消和分别持久化通过')
 }finally{window.destroy();await fs.rm(preload,{force:true})}
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)})
