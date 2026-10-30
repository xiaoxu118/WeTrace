const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
app.on('window-all-closed',()=>{})
app.whenReady().then(async()=>{
 const reference=await fs.readFile(path.resolve('scripts/test-report-ui.cjs'),'utf8')
 const marker='await fs.writeFile(preload, `'
 const begin=reference.indexOf(marker)+marker.length
 let source=reference.slice(begin,reference.indexOf('\n`)',begin))
 source=source.replace("contextBridge.exposeInMainWorld('wetrace', api)",`
 const requests=[]; let delta=()=>{}; let release; let hold=false
 api.holdAi=async()=>{hold=true}
 api.releaseAi=async()=>{hold=false;release?.()}
 api.onAiProgress=()=>()=>{}
 api.onAiDelta=callback=>{delta=callback;return ()=>{}}
 api.listModelConfigs=async()=>[{id:'test-model',name:'测试模型',kind:'text',source:'remote',isDefault:true}]
 data.conversations[0].messages.push({id:'forward',createdAt:1000,messageType:81604378673,from:'them',text:'群聊记录',forwarded:{title:'群聊记录',entries:[{sender:'原发言者',time:'昨天',text:'合并转发里的任务'}]}})
 data.conversations[1]={...data.conversations[1],id:'friend',name:'另一位联系人',type:'friend',messages:[{id:'other',createdAt:2000,messageType:1,from:'them',text:'另一段独立内容'}]}
 api.askAi=async input=>{requests.push(input);if(hold){delta({requestId:input.requestId,text:'仅属于原会话的部分输出'});await new Promise(resolve=>{release=resolve})}await new Promise(resolve=>setTimeout(resolve,100));delta({requestId:input.requestId,text:'整理完成'});return {ok:true,answer:'整理完成'}}
 api.aiContextRequests=async()=>requests
 contextBridge.exposeInMainWorld('wetrace', api)
 `)
 await fs.mkdir('.cache',{recursive:true})
 const preload=path.resolve('.cache/ask-conversation-ui-preload.cjs')
 await fs.writeFile(preload,source)
 const window=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload,sandbox:false,offscreen:true,partition:'ask-conversation-'+Date.now()}})
 const run=code=>window.webContents.executeJavaScript(code)
 const until=async code=>{for(let i=0;i<80;i++){if(await run(code))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('UI timeout '+code+' '+await run('document.body.innerText.slice(0,800)'))}
 try{
  await window.loadFile(path.resolve('out/renderer/index.html'))
  await until(`!!document.querySelector('.chat-head .ops')`)
  assert.equal((await run('window.wetrace.aiContextRequests()')).length,0)
  await run(`Array.from(document.querySelectorAll('.chat-head button')).find(b=>b.textContent==='问 AI').click()`)
  await until(`document.querySelector('.ai-view').getBoundingClientRect().width>0 && !!document.querySelector('.ai-context-scope')`)
  assert.equal((await run('window.wetrace.aiContextRequests()')).length,0)
  assert.equal(await run(`document.querySelector('[aria-label="向 AI 提问"]').value`),'')
  await run(`(()=>{const input=document.querySelector('[aria-label="向 AI 提问"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'最近3天讨论了什么？');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await run(`document.querySelector('[aria-label="发送消息"]').click()`)
  await until(`document.querySelectorAll('.ai-turn.assistant').length===1 && !document.querySelector('.ai-working')`)

  let requests=await run('window.wetrace.aiContextRequests()')
  assert.equal(requests.length,1)
  assert.equal(requests[0].context.conversationId,'test@chatroom')
  assert.equal(requests[0].context.messages,undefined)
  assert.ok((await run(`document.querySelector('.ai-context-scope').textContent`)).includes('已关联'))
  await run(`(()=>{const input=document.querySelector('[aria-label="向 AI 提问"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'有哪些待办？');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await run(`document.querySelector('[aria-label="发送消息"]').click()`)
  await until(`document.querySelectorAll('.ai-turn.assistant').length===2 && !document.querySelector('.ai-working')`)
  requests=await run('window.wetrace.aiContextRequests()')
  assert.deepEqual(requests[1].context,requests[0].context)
  assert.equal(requests[1].turns.length,3)
  await run(`document.querySelector('.ai-new-chat').click()`)
  await until(`!document.querySelector('.ai-context-scope')`)
  await run(`document.querySelector('button[aria-label="消息"]').click()`)
  await run(`Array.from(document.querySelectorAll('.chips button')).find(b=>b.textContent==='联系人').click()`)
  await until(`document.querySelector('.chat-head').textContent.includes('另一位联系人')`)
  await run(`Array.from(document.querySelectorAll('.chat-head button')).find(b=>b.textContent==='问 AI').click()`)
  await until(`document.querySelector('.ai-context-scope').textContent.includes('另一位联系人')`)
  assert.equal((await run('window.wetrace.aiContextRequests()')).length,2)
  await run(`(()=>{const input=document.querySelector('[aria-label="向 AI 提问"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'昨天聊了什么？');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await run(`document.querySelector('[aria-label="发送消息"]').click()`)
  await until(`document.querySelectorAll('.ai-turn.assistant').length===1 && !document.querySelector('.ai-working')`)

  requests=await run('window.wetrace.aiContextRequests()')
  assert.equal(requests.length,3)
  assert.equal(requests[2].context.conversationId,'friend')
  assert.equal(requests[2].turns.length,1)
  assert.equal(requests[2].context.messages,undefined)
  assert.equal(await run(`document.documentElement.scrollWidth<=innerWidth`),true)
  await run('window.wetrace.holdAi()')
  await run(`(()=>{const input=document.querySelector('[aria-label="向 AI 提问"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'生成期间切换测试');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await run(`document.querySelector('[aria-label="发送消息"]').click()`)
  await until(`!!document.querySelector('.ai-working')`)
  await run(`Array.from(document.querySelectorAll('.ai-history-open')).find(button=>button.getAttribute('aria-current')!=='page').click()`)
  await until(`!!document.querySelector('.ai-background-job')`)
  assert.equal(await run(`!!document.querySelector('.ai-working')`),false)
  assert.equal(await run(`document.querySelector('.ai-messages').textContent.includes('仅属于原会话的部分输出')`),false)
  await run(`(()=>{const input=document.querySelector('[aria-label="向 AI 提问"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'另一个会话的草稿');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await until(`JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key=>key.startsWith('wetrace:ai-chats:') && !key.endsWith(':active')))||'[]').some(chat=>chat.turns.some(turn=>turn.content.includes('仅属于原会话的部分输出')))`)
  await run('window.wetrace.releaseAi()')
  await until(`!document.querySelector('.ai-background-job')`)
  assert.equal(await run(`document.querySelector('[aria-label="向 AI 提问"]').value`),'另一个会话的草稿')
  assert.equal(await run(`document.querySelector('.ai-messages').textContent.includes('生成期间切换测试')`),false)
  await run(`Array.from(document.querySelectorAll('.ai-history-open')).find(button=>button.getAttribute('aria-current')!=='page').click()`)
  await until(`document.querySelector('.ai-messages').textContent.includes('生成期间切换测试')`)
  assert.equal(await run(`document.querySelectorAll('.ai-turn.assistant').length`),2)
  const previousCount=await run(`document.querySelectorAll('.ai-history-open').length`)
  await run(`document.querySelector('button[aria-label="消息"]').click()`)
  await run(`Array.from(document.querySelectorAll('.chat-head button')).find(b=>b.textContent==='问 AI').click()`)
  await until(`document.querySelector('.ai-view').getBoundingClientRect().width>0`)
  assert.equal(await run(`document.querySelectorAll('.ai-history-open').length`),previousCount)
  assert.equal(await run(`document.querySelector('.ai-messages').textContent.includes('生成期间切换测试')`),true)
  const noModelPreload=path.resolve('.cache/ask-conversation-no-model-preload.cjs')
  await fs.writeFile(noModelPreload,source.replace("api.listModelConfigs=async()=>[{id:'test-model',name:'测试模型',kind:'text',source:'remote',isDefault:true}]",'api.listModelConfigs=async()=>[]'))
  const noModelWindow=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload:noModelPreload,sandbox:false,offscreen:true,partition:'ask-ai-no-model'}})
  try {
    await noModelWindow.loadFile(path.resolve('out/renderer/index.html'))
    for(let i=0;i<80;i++) {
      if(await noModelWindow.webContents.executeJavaScript(`!!document.querySelector('.chat-head .ops')`))break
      await new Promise(resolve=>setTimeout(resolve,100))
    }
    await noModelWindow.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.chat-head button')).find(b=>b.textContent==='问 AI').click()`)
    await noModelWindow.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    assert.equal((await noModelWindow.webContents.executeJavaScript('window.wetrace.aiContextRequests()')).length,0)
    assert.ok((await noModelWindow.webContents.executeJavaScript(`document.querySelector('.ai-input-area').textContent`)).includes('配置语言模型'))
    assert.ok((await noModelWindow.webContents.executeJavaScript(`document.querySelector('.ai-context-scope').textContent`)).includes('已关联'))
  } finally { noModelWindow.destroy();await fs.rm(noModelPreload,{force:true}) }
  console.log('问 AI 界面通过：群聊与联系人按钮、不自动发送、输入框留空、仅关联会话、手动发送、范围提示、追问复用、新建清空、生成期间切换、原会话回写、草稿保留和会话隔离。')
 }finally{window.destroy();await fs.rm(preload,{force:true})}
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)})
