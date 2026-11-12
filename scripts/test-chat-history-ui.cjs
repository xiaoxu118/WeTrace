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
const messages = Array.from({length:185}, (_,i)=>({id:String(i+1),createdAt:(i+1)*1000,messageType:1,from:'them',avatar:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22/%3E',text:'历史消息 '+(i+1),time:'12:00'}))
data.conversations = [{...data.conversations[0],id:'friend',type:'friend',name:'测试联系人',records:'60',messages:messages.slice(-60)}]
api.onAiProgress = () => () => {}
const queries = []; let fail = true
api.queryConversationSummary = async () => ({ok:true,data:{total:messages.length,firstAt:1000,lastAt:messages.length*1000}})
api.getIndexedConversation = async query => { queries.push(query); if(fail){fail=false;return {ok:false,error:'模拟失败，请重试'}};return {ok:true,conversation:{...data.conversations[0],records:'185',messages:messages.slice(-query.limit).map(({avatar,...message})=>message)}} }
let changed = () => {}; let refreshes = 0; let holdNext=false; let releaseHeld
api.onDatabaseChanged = callback => { changed = callback; return () => {} }
api.syncWechat = async () => { refreshes++; const response={ok:true,data:{...data,conversations:[{...data.conversations[0],messages:messages.slice(-60)}],syncedAt:new Date().toISOString()}};if(holdNext){holdNext=false;await new Promise(resolve=>{releaseHeld=resolve})}return response }
api.appendHistoryFixture = async () => { const id=String(messages.length+1);messages.push({id,createdAt:Number(id)*1000,messageType:1,from:'them',text:'新到消息 '+id,time:'12:01'});changed('/test') }
api.beginHeldOriginal = async () => {holdNext=true;const id=String(messages.length+1);messages.push({id,createdAt:Number(id)*1000,messageType:1,from:'me',text:'快速发送测试原文',time:'12:02'});changed('/test')}
api.recallHeldOriginal = async () => {const old=messages.at(-1);messages[messages.length-1]={...old,messageType:10000,text:'你撤回了一条消息',revoke:{}};changed('/test')}
api.releaseHeldSync = async () => releaseHeld?.()
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
  const until = async code => {
    for(let i=0;i<80;i++){if(await run(code))return;await new Promise(resolve=>setTimeout(resolve,100))}
    const rows=await run('document.querySelectorAll(".chat-scroll .mrow").length')
    const refreshes=await run('window.wetrace.historyRefreshes()')
    throw new Error('UI timeout '+code+' rows='+rows+' refreshes='+refreshes)
  }
  try {
    await window.loadFile(path.resolve('out/renderer/index.html'))
    await until(`!!document.querySelector('.conv-list')`)
    await run(`Array.from(document.querySelectorAll('.chips button')).find(b=>b.textContent==='联系人').click()`)
    await until(`document.querySelector('.chat-head')?.textContent.includes('185')`)
    assert.equal(await run(`document.querySelectorAll('.chat-scroll .mrow').length`),60)
    await new Promise(resolve=>setTimeout(resolve,400))
    const load = () => run(`(()=>{const el=document.querySelector('.chat-scroll');el.scrollTop=300;el.dispatchEvent(new Event('scroll',{bubbles:true}));el.scrollTop=100;const row=Array.from(el.querySelectorAll('.mrow')).find(row=>row.getBoundingClientRect().bottom>el.getBoundingClientRect().top+40);window.historyAnchor={text:row.querySelector('.bubble').textContent,top:row.getBoundingClientRect().top};el.dispatchEvent(new Event('scroll',{bubbles:true}))})()`)
    await load()
    await until(`document.querySelector('.toast')?.textContent.includes('模拟失败')`)
    assert.equal(await run(`document.querySelectorAll('.chat-scroll .mrow').length`),60)
    await run(`window.existingHistoryRows = Array.from(document.querySelectorAll('.chat-scroll .mrow')).map(row => ({id: row.dataset.messageId, row, avatar: row.querySelector('.profile-avatar img')})); void 0`)
    for (const count of [120,180,185]) {
      await load()
      await until(`document.querySelectorAll('.chat-scroll .mrow').length===${count}`)
      assert.ok(await run(`window.existingHistoryRows.every(saved => {const row = Array.from(document.querySelectorAll('.chat-scroll .mrow')).find(item => item.dataset.messageId === saved.id); return row === saved.row && saved.avatar && row.querySelector('.profile-avatar img') === saved.avatar})`), '加载历史应复用已有消息和头像元素，避免重新加载')
      assert.equal(await run(`document.querySelectorAll('.chat-scroll .mrow .profile-avatar img').length`), count, '历史接口暂缺头像时，同一联系人已有头像应复用到所有消息')
      await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
      assert.ok(await run(`(()=>{const row=Array.from(document.querySelectorAll('.chat-scroll .mrow')).find(row=>row.querySelector('.bubble').textContent===window.historyAnchor.text);return Math.abs(row.getBoundingClientRect().top-window.historyAnchor.top)<2})()`), '加载更早消息后保持当前阅读位置')
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
    await run(`document.querySelector('.chat-scroll').scrollTop = 0`)
    await run(`document.querySelector('button[aria-label="AI 对话"]').click()`)
    await until(`!document.querySelector('.chat-scroll')`)
    await run(`document.querySelector('button[aria-label="消息"]').click()`)
    await until(`(() => { const el = document.querySelector('.chat-scroll'); return el && el.scrollHeight - el.clientHeight - el.scrollTop < 2 })()`)
    await run('window.wetrace.appendHistoryFixture()')
    await until(`document.querySelectorAll('.chat-scroll .mrow').length===186`)
    await until(`(() => {const el=document.querySelector('.chat-scroll');return el.scrollHeight-el.clientHeight-el.scrollTop<2})()`)
    await run(`document.querySelector('.chat-scroll-content .mrow:last-child .bubble').style.paddingBottom='250px'`)
    await until(`(() => {const el=document.querySelector('.chat-scroll');return el.scrollHeight-el.clientHeight-el.scrollTop<2})()`)
    await run(`(()=>{const el=document.querySelector('.chat-scroll');el.scrollTop=0;el.dispatchEvent(new Event('scroll'))})()`)
    await run('window.wetrace.appendHistoryFixture()')
    await until(`document.querySelectorAll('.chat-scroll .mrow').length===187`)
    assert.ok(await run(`document.querySelector('.chat-scroll').scrollTop<5`),'阅读历史时不能被新消息拉到底部')
    await run(`(()=>{const el=document.querySelector('.chat-scroll');el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'))})()`)
    await run('window.wetrace.appendHistoryFixture()')
    await until(`document.querySelectorAll('.chat-scroll .mrow').length===188`)
    await until(`(() => {const el=document.querySelector('.chat-scroll');return el.scrollHeight-el.clientHeight-el.scrollTop<2})()`)
    await new Promise(resolve=>setTimeout(resolve,350))
    const beforeRapid=await run('window.wetrace.historyRefreshes()')
    await run('window.wetrace.beginHeldOriginal()')
    await new Promise(resolve=>setTimeout(resolve,80))
    assert.ok(await run('window.wetrace.historyRefreshes()')>beforeRapid,'首次变化必须立即读取，不得等待原来的 1.2 秒防抖')
    await run('window.wetrace.recallHeldOriginal()')
    await run('window.wetrace.releaseHeldSync()')
    await until(`document.querySelector('.chat-scroll-content .mrow:last-child').textContent.includes('你撤回了一条消息')`)
    assert.ok(await run('window.wetrace.historyRefreshes()')>=beforeRapid+2,'读取期间的撤回事件必须触发后续读取')
    console.log('快速撤回刷新通过：首次事件立即读取，读取期间的新事件不丢失。')
    console.log('新消息滚动通过：底部自动跟随、延迟内容增高继续跟随、阅读历史不跳动、滚回底部恢复跟随。')
    console.log('消息页定位通过：离开后返回同一会话，自动定位到最后一条消息。')
    console.log('聊天历史界面通过：联系人真实总数、失败重试、60→120→180→185、无重复及末页停止。')
  } finally {window.destroy();await fs.rm(preload,{force:true})}
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)})
