// Real durable history store + mock model APIs; no private data or remote model calls.
const { app, BrowserWindow, ipcMain } = require('electron')
const { stripTypeScriptTypes } = require('node:module')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const historySource=stripTypeScriptTypes(await fs.readFile(path.resolve('src/main/ai-chat-history-store.ts'),'utf8'))
  const {AiChatHistoryStore}=await import('data:text/javascript;base64,'+Buffer.from(historySource).toString('base64'))
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wetrace-ai-memory-ui-'))
  let historyStore=new AiChatHistoryStore(directory)
  const legacy={chats:[{id:'memory-chat',title:'虚构记忆测试',updatedAt:1,turns:Array.from({length:42},(_,i)=>({role:i%2?'assistant':'user',content:'虚构历史'+i})),memory:{version:1,scope:'fixture',summary:'已保存的记忆',coveredTurns:2,prefixHash:'fixture'}}],activeId:'memory-chat'}
  let historyEnabled=false
  ipcMain.handle('fixture:history-enable',()=>{historyEnabled=true})
  ipcMain.handle('fixture:history-load',async (_event,input)=>{try{if(!historyEnabled)return {ok:true,archive:{chats:[],activeId:null},revision:0};const stored=await historyStore.load(input);return {ok:true,...stored}}catch(error){return {ok:false,error:error.message}}})
  ipcMain.handle('fixture:history-save',async (_event,input)=>{try{if(!historyEnabled)return {ok:true,revision:0};return {ok:true,revision:await historyStore.save(input)}}catch(error){return {ok:false,error:error.message}}})
  ipcMain.handle('fixture:history-get',()=>historyStore.load({root:'/test'}))
  const reference=await fs.readFile(path.resolve('scripts/test-report-ui.cjs'),'utf8')
  const marker='await fs.writeFile(preload, `'
  const begin=reference.indexOf(marker)+marker.length
  const end=reference.indexOf('\n`)',begin)
  const source=reference.slice(begin,end).replace("contextBridge.exposeInMainWorld('wetrace', api)",`
  const {ipcRenderer}=require('electron')
  api.loadAiChatHistory=input=>ipcRenderer.invoke('fixture:history-load',input)
  api.saveAiChatHistory=input=>ipcRenderer.invoke('fixture:history-save',input)
  api.memoryArchive=()=>ipcRenderer.invoke('fixture:history-get')
  api.memoryEnableHistory=()=>ipcRenderer.invoke('fixture:history-enable')
  let lastInput
  api.askAi=async input=>{lastInput=input;return {ok:true,answer:'已沿用对话记忆',memory:{version:1,scope:'fixture',summary:'更新后的记忆',coveredTurns:2,prefixHash:'fixture'}}}
  api.memoryLastInput=()=>lastInput
  api.cancelAi=async()=>{}
  contextBridge.exposeInMainWorld('wetrace', api)
  `)
  const preload=path.resolve('.cache/ai-memory-ui-preload.cjs')
  await fs.mkdir(path.dirname(preload),{recursive:true})
  await fs.writeFile(preload,source)
  const window=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload,sandbox:false,offscreen:true,partition:'ai-memory-ui-'+Date.now()}})
  const run=code=>window.webContents.executeJavaScript(code)
  const until=async code=>{for(let i=0;i<80;i++){if(await run(code))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('UI timeout '+code)}
  const openAi=()=>run(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='AI 对话').click()`)
  const send=async text=>{
    await run(`(()=>{const input=document.querySelector('[aria-label="向 AI 提问"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await until(`!!document.querySelector('[aria-label="发送消息"]')&&!document.querySelector('[aria-label="发送消息"]').disabled`)
    await run(`document.querySelector('[aria-label="发送消息"]').click()`)
    await until(`window.wetrace.memoryLastInput()?.turns.at(-1)?.content===${JSON.stringify(text)} && document.querySelector('.ai-messages').textContent.includes('已沿用对话记忆')`)
  }
  try {
    await window.loadFile(path.resolve('out/renderer/index.html'))
    await until(`!!document.querySelector('.conv-list')`)
    await run(`localStorage.setItem('wetrace:ai-chats:/test',${JSON.stringify(JSON.stringify(legacy.chats))});localStorage.setItem('wetrace:ai-chats:/test:active','memory-chat')`)
    await run('window.wetrace.memoryEnableHistory()')
    await window.reload()
    await until(`!!document.querySelector('.conv-list')`)
    await openAi()
    await until(`document.querySelector('.ai-history-open')?.textContent==='虚构记忆测试'`)
    await send('继续分析')
    let sent=await run('window.wetrace.memoryLastInput()')
    assert.equal(sent.memory.summary,'已保存的记忆')
    assert.equal(sent.turns.length,43,'more than forty turns can continue')
    await until(`window.wetrace.memoryArchive().then(value=>value.archive.chats[0].memory.summary==='更新后的记忆')`)
    assert.equal(await run(`JSON.parse(localStorage.getItem('wetrace:ai-chats:/test'))[0].memory.summary`),'已保存的记忆','legacy browser copy is left untouched; new writes go to disk')
    // Simulate loss of all renderer storage and recreation of the main history service.
    await run('localStorage.clear()')
    historyStore=new AiChatHistoryStore(directory)
    await window.reload()
    await until(`!!document.querySelector('.conv-list')`)
    await openAi()
    await until(`document.querySelector('.ai-history-open')?.textContent==='虚构记忆测试'`)
    await send('重开后继续')
    sent=await run('window.wetrace.memoryLastInput()')
    assert.equal(sent.memory.summary,'更新后的记忆','cleared browser storage must not lose the disk summary')
    await run(`document.querySelector('.ai-new-chat').click()`)
    await until(`document.querySelector('.ai-welcome')?.textContent==='根据会话提问'`)
    await send('新任务')
    sent=await run('window.wetrace.memoryLastInput()')
    assert.equal(sent.memory,undefined,'new chat must not inherit another chat summary')
    assert.equal(sent.turns.length,1)
    await until(`window.wetrace.memoryArchive().then(value=>value.archive.chats.length===2)`)
    console.log('对话磁盘存储 UI：旧localStorage自动迁移、42条后继续、摘要落盘、清空localStorage与重建服务后恢复、新对话隔离通过')
  } finally {window.destroy();await historyStore.flush();await fs.rm(preload,{force:true});await fs.rm(directory,{recursive:true,force:true})}
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)})
