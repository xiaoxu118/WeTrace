const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const reference = await fs.readFile(path.resolve('scripts/test-report-ui.cjs'), 'utf8')
  const marker = 'await fs.writeFile(preload, `'
  const begin = reference.indexOf(marker) + marker.length
  const end = reference.indexOf('\n`)', begin)
  const source = reference.slice(begin, end).replace("contextBridge.exposeInMainWorld('wetrace', api)", `
  data.conversations = [{...data.conversations[0],id:'friend',type:'friend',name:'虚构联系人',messages:[{id:'voice-1',createdAt:1000,messageType:34,from:'them',text:'[语音]',time:'12:00'}]}]
  let calls=0
  api.transcribeVoiceMessage=async query=>{calls++; if(query.id!=='voice-1'||query.conversationId!=='friend')throw new Error('消息定位错误');return calls===1?{ok:false,error:'模拟：请先下载离线模型'}:{ok:true,text:'虚构语音转写内容'}}
  api.voiceCalls=()=>calls
  contextBridge.exposeInMainWorld('wetrace', api)
  `)
  await fs.mkdir(path.resolve('.cache'),{recursive:true})
  const preload=path.resolve('.cache/voice-message-ui-preload.cjs')
  await fs.writeFile(preload,source)
  const window=new BrowserWindow({show:false,webPreferences:{preload,sandbox:false,offscreen:true}})
  const run=code=>window.webContents.executeJavaScript(code)
  const until=async code=>{for(let i=0;i<80;i++){if(await run(code))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('UI timeout: '+code)}
  try {
    await window.loadFile(path.resolve('out/renderer/index.html'))
    await until(`!!document.querySelector('.conv-list')`)
    await run(`Array.from(document.querySelectorAll('.chips button')).find(b=>b.textContent==='联系人').click()`)
    await until(`!!document.querySelector('.message-voice button')`)
    assert.equal(await run('window.wetrace.voiceCalls()'),0,'不自动批量识别')
    await run(`document.querySelector('.message-voice button').click()`)
    await until(`document.querySelector('.message-voice').textContent.includes('模拟：请先下载')`)
    await run(`document.querySelector('.message-voice button').click()`)
    await until(`document.querySelector('.message-voice').textContent.includes('虚构语音转写内容')`)
    assert.equal(await run('window.wetrace.voiceCalls()'),2)
    assert.equal(await run(`document.querySelector('.message-voice button')===null`),true)
    console.log('语音列表UI：按需识别、失败提示、重试及原位展示通过')
  } finally {window.destroy();await fs.rm(preload,{force:true})}
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)})
