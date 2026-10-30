const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const reference = await fs.readFile('scripts/test-report-ui.cjs', 'utf8')
  const begin = reference.indexOf('await fs.writeFile(preload, `') + 'await fs.writeFile(preload, `'.length
  let source = reference.slice(begin, reference.indexOf('\n`)', begin))
  source = source.replace("contextBridge.exposeInMainWorld('wetrace', api)", `
let calls = []; let fail = false
api.onAiProgress = () => () => {}
api.refreshTestCalls = async () => calls
api.refreshTestFail = () => { fail = true }
api.getIndexedConversation = async query => {
  calls.push(query); await new Promise(resolve => setTimeout(resolve, 180))
  if (fail) return {ok:false,error:'模拟刷新失败'}
  return {ok:true,conversation:{...data.conversations[0],id:query.conversationId,messages:[{...data.conversations[0].messages[0],id:'fresh',text:'最新本地消息'}]}}
}
contextBridge.exposeInMainWorld('wetrace', api)
`)
  const preload = path.resolve('.cache/conversation-refresh-preload.cjs')
  await fs.mkdir('.cache', { recursive: true }); await fs.writeFile(preload, source)
  const win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { preload, sandbox: false, offscreen: true } })
  try {
    await win.loadFile(path.resolve('out/renderer/index.html'))
    const run = code => win.webContents.executeJavaScript(code)
    const until = async code => { for (let i = 0; i < 60; i++) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 100)) } throw new Error('UI timeout: ' + code + '\n' + await run('document.body.innerText.slice(0,1500)')) }
    await until(`!!document.querySelector('[aria-label="刷新当前聊天记录"]')`)
    assert.equal(await run(`!!document.querySelector('.chat-name [aria-label="刷新当前聊天记录"]')`), true)
    await run(`document.querySelector('[aria-label="刷新当前聊天记录"]').click()`)
    assert.equal(await run(`document.querySelector('[aria-label="刷新当前聊天记录"]').disabled`), true)
    await until(`document.querySelector('.chat-scroll').textContent.includes('最新本地消息') && !document.querySelector('[aria-label="刷新当前聊天记录"]').disabled`)
    const calls = await run('window.wetrace.refreshTestCalls()')
    assert.equal(calls.length, 1); assert.equal(calls[0].refresh, true); assert.equal(calls[0].at, undefined)
    await run(`window.wetrace.refreshTestFail(); document.querySelector('[aria-label="刷新当前聊天记录"]').click()`)
    await until(`document.body.innerText.includes('模拟刷新失败') && !document.querySelector('[aria-label="刷新当前聊天记录"]').disabled`)
    assert.equal(await run(`document.querySelector('.chat-scroll').textContent.includes('最新本地消息')`), true)
    await fs.mkdir('.screenshots', { recursive: true })
    await fs.writeFile('.screenshots/conversation-refresh.png', (await win.webContents.capturePage()).toPNG())
    console.log('会话刷新界面通过：昵称旁入口、加载状态、直接刷新请求、最新消息展示、失败保留消息并允许重试。')
  } finally { win.destroy(); await fs.rm(preload, { force: true }) }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
