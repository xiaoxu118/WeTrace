const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
 const reference = await fs.readFile(path.resolve('scripts/test-report-ui.cjs'), 'utf8')
 const marker = 'await fs.writeFile(preload, `', begin = reference.indexOf(marker) + marker.length
 let source = reference.slice(begin, reference.indexOf('\n`)', begin))
 source = source.replace("contextBridge.exposeInMainWorld('wetrace', api)", `
 data.conversations[0].messages=[
  {id:'captured',createdAt:1000,messageType:10000,from:'me',text:'你撤回了一条消息',revoke:{},recall:{original:'会话中已捕获的原文[微笑]',originalAt:1000},time:'12:00'},
  {id:'missing',createdAt:2000,messageType:10000,from:'me',text:'你撤回了一条消息',revoke:{unresolvedReason:'unlinked'},time:'12:01'}
 ];
 api.groupMonitor=async()=>({ok:true,data:{rooms:[],events:[]}});
 contextBridge.exposeInMainWorld('wetrace', api)
 `)
 const preload = path.resolve('.cache/chat-recall-ui-preload.cjs')
 await fs.writeFile(preload, source)
 const window = new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload,sandbox:false,offscreen:true,partition:'chat-recalls-'+Date.now()}})
 const run = code => window.webContents.executeJavaScript(code)
 const until = async code => {for(let i=0;i<80;i++){if(await run(code))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('UI timeout: '+code)}
 try {
  await window.loadFile(path.resolve('out/renderer/index.html'))
  await until(`document.querySelector('.message-recalled')?.textContent.includes('会话中已捕获的原文')`)
  assert.ok(await run(`document.querySelector('.message-recalled').textContent.includes('已保留原文')`))
  assert.ok(await run(`document.querySelector('.message-revoke-notice').textContent.includes('你撤回了一条消息')`))
  assert.ok(await run(`document.querySelector('.message-revoke-notice').textContent.includes('已保存会话消息，但暂无法确定对应原文')`))
  assert.equal(await run(`document.querySelector('.message-revoke-notice').textContent.includes('<sysmsg')`),false)
  assert.ok(await run(`document.querySelector('.message-recalled').closest('.mrow').classList.contains('me')`))
  console.log('聊天撤回 UI 测试通过：未开启群监控时展示已捕获原文、未捕获提示、可读通知与本人消息方向。')
 } finally {window.destroy();await fs.rm(preload,{force:true})}
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)})
