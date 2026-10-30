const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const reference = await fs.readFile(path.resolve('scripts/test-report-ui.cjs'), 'utf8')
  const begin = reference.indexOf('await fs.writeFile(preload, `') + 'await fs.writeFile(preload, `'.length
  const end = reference.indexOf('\n`)', begin)
  let source = reference.slice(begin, end)
  source = source.replace("contextBridge.exposeInMainWorld('wetrace', api)", `
const messages = Array.from({length:185}, (_,i)=>({id:String(i+1),createdAt:(i+1)*1000,messageType:1,from:'them',text:'历史消息 '+(i+1),time:'12:00'}))
data.conversations = [{...data.conversations[0],id:'friend',type:'friend',name:'测试联系人',records:'60',messages:messages.slice(-60)}]
api.onAiProgress = () => () => {}
const queries = []; let fail = true
api.queryConversationSummary = async () => ({ok:true,data:{total:185,firstAt:1000,lastAt:185000}})
api.getIndexedConversation = async query => { queries.push(query); if(fail){fail=false;return {ok:false,error:'模拟失败，请重试'}};return {ok:true,conversation:{...data.conversations[0],records:'185',messages:messages.slice(-query.limit)}} }
let changed = () => {}; let refreshes = 0
api.onDatabaseChanged = callback => { changed = callback; return () => {} }
api.syncWechat = async () => { refreshes++; return {ok:true,data:{...data,syncedAt:new Date().toISOString()}} }
api.refreshHistoryFixture = async () => { changed('/test') }
api.historyRefreshes = async () => refreshes
api.historyQueries = async () => queries
contextBridge.exposeInMainWorld('wetrace', api)
`)
  await fs.mkdir('.cache',{recursive:true})
  const preload = path.resolve('.cache/chat-history-ui-preload.cjs')
  await fs.writeFile(preload,source)
  const window = new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload,sandbox:false,offscreen:true}})
  const run = code => window.webContents.executeJavaScript(code)
  const until = async code => {for(let i=0;i<80;i++){if(await run(code))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('UI timeout '+code)}
  try {
    await window.loadFile(path.resolve('out/renderer/index.html'))
    await until(`!!document.querySelector('.conv-list')`)
    await run(`Array.from(document.querySelectorAll('.chips button')).find(b=>b.textContent==='联系人').click()`)
    await until(`document.querySelector('.chat-head')?.textContent.includes('185')`)
    assert.equal(await run(`document.querySelectorAll('.chat-scroll .mrow').length`),60)
    const load = () => run(`document.querySelector('.chat-history-control button').click()`)
    await load()
    await until(`document.querySelector('.chat-history-control button')?.disabled===false`)
    assert.equal(await run(`document.querySelectorAll('.chat-scroll .mrow').length`),60)
    for (const count of [120,180,185]) {
      await load()
      await until(`document.querySelectorAll('.chat-scroll .mrow').length===${count}`)
    }
    assert.equal(await run(`document.querySelector('.chat-history-control button')===null`),true)
    assert.ok((await run(`document.querySelector('.chat-scroll').textContent`)).includes('历史消息 1'))
    assert.deepEqual((await run('window.wetrace.historyQueries()')).map(q=>q.limit),[120,120,180,240])
    assert.equal(await run(`new Set(Array.from(document.querySelectorAll('.chat-scroll .bubble')).map(n=>n.textContent)).size`),185)
    const refreshes = await run('window.wetrace.historyRefreshes()')
    await run('window.wetrace.refreshHistoryFixture()')
    await until(`window.wetrace.historyRefreshes().then(n=>n>${refreshes})`)
    await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    assert.equal(await run(`document.querySelectorAll('.chat-scroll .mrow').length`),185)
    console.log('聊天历史界面通过：联系人真实总数、失败重试、60→120→180→185、无重复及末页停止。')
  } finally {window.destroy();await fs.rm(preload,{force:true})}
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)})
