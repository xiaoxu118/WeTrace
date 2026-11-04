// Exercise the built preload, not a replacement API fixture. No WeChat data is accessed.
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const assert = require('node:assert/strict')
app.whenReady().then(async () => {
  ipcMain.handle('wechat:voice-transcribe', (_event, query) => {
    assert.equal(query.id, 'fixture-voice')
    return { ok: true, text: '虚构转写结果' }
  })
  ipcMain.handle('ai:history-load', (_event, input) => { assert.equal(input.root, '/fixture'); return {ok:true,archive:{chats:[],activeId:null},revision:1} })
  ipcMain.handle('ai:history-save', (_event, input) => { assert.equal(input.revision,1); return {ok:true,revision:2} })
  const window = new BrowserWindow({ show: false, webPreferences: { preload: path.resolve('out/preload/index.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: false } })
  try {
    await window.loadURL('about:blank')
    assert.equal(await window.webContents.executeJavaScript('typeof window.wetrace?.transcribeVoiceMessage'), 'function')
    const result = await window.webContents.executeJavaScript(`window.wetrace.transcribeVoiceMessage({conversationId:'fixture',id:'fixture-voice',createdAt:1000})`)
    assert.deepEqual(result, { ok: true, text: '虚构转写结果' })
    const history = await window.webContents.executeJavaScript(`window.wetrace.loadAiChatHistory({root:'/fixture'})`)
    assert.deepEqual(history,{ok:true,archive:{chats:[],activeId:null},revision:1})
    const saved = await window.webContents.executeJavaScript(`window.wetrace.saveAiChatHistory({root:'/fixture',archive:{chats:[],activeId:null},revision:1})`)
    assert.deepEqual(saved,{ok:true,revision:2})
    console.log('真实构建 preload：语音与本地对话读写接口暴露、IPC 调用通过')
  } finally { window.destroy() }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
