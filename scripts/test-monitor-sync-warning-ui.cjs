// Mock chat records and nonfatal monitor failure; no local WeChat data is accessed.
const {app,BrowserWindow}=require('electron')
const fs=require('node:fs/promises')
const path=require('node:path')
const assert=require('node:assert/strict')
app.on('window-all-closed',()=>{})
app.whenReady().then(async()=>{
 const reference=await fs.readFile(path.resolve('scripts/test-report-ui.cjs'),'utf8')
 const marker='await fs.writeFile(preload, `',begin=reference.indexOf(marker)+marker.length
 const source=reference.slice(begin,reference.indexOf('\n`)',begin)).replace("contextBridge.exposeInMainWorld('wetrace', api)",`data.monitorWarning='群监控与撤回原文缓存暂不可用，聊天记录已正常读取；请稍后刷新重试。';contextBridge.exposeInMainWorld('wetrace', api)`)
 const preload=path.resolve('.cache/monitor-sync-warning-ui-preload.cjs')
 await fs.mkdir(path.dirname(preload),{recursive:true});await fs.writeFile(preload,source)
 const window=new BrowserWindow({show:false,webPreferences:{preload,sandbox:false,offscreen:true,partition:'monitor-warning-'+Date.now()}})
 const run=code=>window.webContents.executeJavaScript(code)
 try {
  await window.loadFile(path.resolve('out/renderer/index.html'))
  for(let i=0;i<80;i++){
   if(await run(`!!document.querySelector('.conv-list')&&document.querySelector('.conv-top')?.textContent.includes('部分本地缓存暂不可用')`))break
   await new Promise(resolve=>setTimeout(resolve,100))
  }
  assert.ok(await run(`document.querySelector('.conv-top')?.textContent.includes('聊天记录已正常读取')`))
  assert.ok(await run(`document.querySelectorAll('.conv-list .conv').length>0`),'monitor persistence error must not hide conversations')
  assert.ok(await run(`document.querySelectorAll('.chat-scroll .mrow').length>0`),'messages remain usable')
  console.log('监控失败启动UI：提示局部缓存异常，同时展示会话和消息通过')
 }finally{window.destroy();await fs.rm(preload,{force:true})}
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)})
