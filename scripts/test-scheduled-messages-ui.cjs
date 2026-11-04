// Real scheduler and renderer, synthetic transport: never sends a real message.
const {app,BrowserWindow,ipcMain}=require('electron')
const {stripTypeScriptTypes}=require('node:module')
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict')
app.on('window-all-closed',()=>{})
app.whenReady().then(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wetrace-send-ui-'))
 const source=stripTypeScriptTypes(await fs.readFile('src/main/scheduled-messages.ts','utf8'))
 const {ScheduledMessages}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
 let now=Date.now(),sent=[]
 const scheduler=new ScheduledMessages(directory,{capability:async()=>({supported:true}),recipients:async()=>[{id:'test@chatroom',name:'产品讨论群'}],send:async(root,task)=>{sent.push({root,recipientId:task.recipientId,content:task.content});return{taskId:task.id,recipientId:task.recipientId,receipt:'fixture-only'}}},text=>Buffer.from(text).map(byte=>byte^85),bytes=>Buffer.from(bytes).map(byte=>byte^85).toString(),()=>now)
 ipcMain.handle('fixture:send',async(_event,root,action)=>{try{return{ok:true,...await scheduler.update(root,action)}}catch(error){return{ok:false,error:error.message}}})
 ipcMain.handle('fixture:tick',async()=>{now+=7200000;await scheduler.tick('/test');return sent})
 const reference=await fs.readFile('scripts/test-report-ui.cjs','utf8'),marker='await fs.writeFile(preload, `',begin=reference.indexOf(marker)+marker.length
 const preload=path.resolve('.cache/send-ui-preload.cjs')
 await fs.mkdir(path.dirname(preload),{recursive:true});await fs.writeFile(preload,reference.slice(begin,reference.indexOf('\n`)',begin)).replace("contextBridge.exposeInMainWorld('wetrace', api)",`const {ipcRenderer}=require('electron');api.scheduledMessages=(root,action)=>ipcRenderer.invoke('fixture:send',root,action);api.tickSend=()=>ipcRenderer.invoke('fixture:tick');contextBridge.exposeInMainWorld('wetrace',api)`))
 const window=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload,sandbox:false,offscreen:true,partition:'send-ui-'+Date.now()}})
 const run=code=>window.webContents.executeJavaScript(code)
 const until=async code=>{for(let i=0;i<80;i++){if(await run(code))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('UI timeout: '+code+'\n'+await run('document.body.innerText'))}
 const click=text=>run(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(text)}).click()`)
 const input=(label,value,textarea=false)=>run(`(()=>{const el=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');Object.getOwnPropertyDescriptor(${textarea?'HTMLTextAreaElement':'HTMLInputElement'}.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`)
 try{
  await window.loadFile(path.resolve('out/renderer/index.html'));await until(`!!document.querySelector('.conv-list')`)
  await run(`document.querySelector('button[aria-label="定时发送"]').click()`)
  await until(`!document.querySelector('[aria-label="启用定时发送"]').disabled`)
  assert.equal(await run(`document.querySelector('[aria-label="启用定时发送"]').getAttribute('aria-checked')`),'false')
  await click('创建任务')
  await run(`document.querySelector('[aria-label="发送接收方"]').closest('.ant-select').querySelector('.ant-select-content').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
  await until(`!!document.querySelector('.ant-select-item-option')`)
  await run(`Array.from(document.querySelectorAll('.ant-select-item-option')).find(el=>el.textContent.includes('产品讨论群')).click()`)
  await input('定时发送内容','仅用于测试的定时内容',true)
  const date=new Date(Date.now()+3600000),pad=n=>String(n).padStart(2,'0'),due=`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  await input('定时发送时间',due);await click('保存待确认任务')
  await until(`document.querySelector('[aria-label="定时发送"] .ant-list')?.textContent.includes('待确认')`)
  assert.deepEqual(await run('window.wetrace.tickSend()'),[])
  // The first draft is now overdue; it still cannot execute without confirmation.
  await click('取消');await until(`document.querySelector('[aria-label="定时发送"] .ant-list')?.textContent.includes('已取消')`)
  await click('执行日志');await until(`Array.from(document.querySelectorAll('.ant-modal')).some(el=>el.textContent.includes('用户取消任务'))`)
  console.log('定时发送UI通过：默认关闭、选择接收方、保存待确认、过期未确认不发送、取消与日志；无真实发送')
 }finally{window.destroy();scheduler.stop();await fs.rm(preload,{force:true});await fs.rm(directory,{recursive:true,force:true})}
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)})
