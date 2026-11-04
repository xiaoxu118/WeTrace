// Simulate an unsupported Windows build; no native tools or user databases are opened.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const reference = await fs.readFile('scripts/test-report-ui.cjs', 'utf8')
  const marker = 'await fs.writeFile(preload, `', begin = reference.indexOf(marker) + marker.length
  const source = reference.slice(begin, reference.indexOf('\n`)', begin)).replace("contextBridge.exposeInMainWorld('wetrace', api)", `
    let syncs=0
    api.getAppInfo=async()=>({version:'fixture',platform:'win32'})
    api.detectWechat=async()=>({account:null,hasKey:false,error:'Windows 微信连接尚未开放：缺少已验证的 WCDB x64 DLL、密钥获取工具和微信 4.x 基线版本。'})
    api.getKeyStatus=async()=>({supported:false,error:'Windows 微信连接尚未开放：缺少已验证的 WCDB x64 DLL、密钥获取工具和微信 4.x 基线版本。',sipEnabled:false,hasKey:false,wechatRunning:false,wechatLoggedIn:false})
    api.syncWechat=async()=>{syncs++;throw new Error('不支持的平台不得同步')}
    api.fixtureSyncs=()=>syncs
    contextBridge.exposeInMainWorld('wetrace',api)
  `)
  const preload = path.resolve('.cache/unsupported-platform-ui-preload.cjs')
  await fs.mkdir(path.dirname(preload),{recursive:true});await fs.writeFile(preload,source)
  const window = new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload,sandbox:false,offscreen:true,partition:'platform-'+Date.now()}})
  try {
    await window.loadFile(path.resolve('out/renderer/index.html'))
    for(let i=0;i<80;i++) { if(await window.webContents.executeJavaScript(`document.body.innerText.includes('当前环境暂不支持')`))break;await new Promise(resolve=>setTimeout(resolve,100)) }
    const text=await window.webContents.executeJavaScript('document.body.innerText')
    assert.ok(text.includes('当前环境暂不支持'))
    assert.ok(text.includes('WCDB x64 DLL'))
    assert.ok(!text.includes('关闭系统完整性保护'))
    assert.equal(await window.webContents.executeJavaScript('window.wetrace.fixtureSyncs()'),0)
    console.log('不支持平台界面通过：Windows显示具体缺口、不展示macOS SIP操作、不触发同步')
  } finally { window.destroy();await fs.rm(preload,{force:true}) }
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)})
