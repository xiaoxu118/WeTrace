// Synthetic preload; directory selection and restart are mocked.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
app.setPath('userData', path.resolve('.cache/cache-directory-ui-profile'))
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  let window
  try {
    const reference = await fs.readFile('scripts/test-report-ui.cjs', 'utf8')
    const begin = reference.indexOf('await fs.writeFile(preload, `') + 'await fs.writeFile(preload, `'.length
    const end = reference.indexOf('\n`)', begin)
    let source = reference.slice(begin, end)
    source = source.replace("contextBridge.exposeInMainWorld('wetrace', api)", `
      let failure = false; let opens = 0;
      api.getCacheDirectory = async () => '/fixture/current-cache';
      api.openCacheDirectory = async () => { opens++; if (failure) throw new Error('fixture failure') };
      api.cacheFixture = async fail => { failure = fail };
      api.cacheOpens = async () => opens;
      contextBridge.exposeInMainWorld('wetrace', api)
    `)
    await fs.mkdir('.cache', { recursive: true })
    const preload = path.resolve('.cache/cache-directory-ui-preload.cjs')
    await fs.writeFile(preload, source)
    window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { preload, sandbox: false, offscreen: true } })
    await window.loadFile(path.resolve('out/renderer/index.html'))
    const run = code => window.webContents.executeJavaScript(code)
    const until = async code => { for (let i = 0; i < 100; i++) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 100)) } throw new Error('UI timeout: ' + code + ' ' + await run('document.body.innerText.slice(0,1000)')) }
    await until(`!!document.querySelector('.conv-list')`)
    await run(`document.querySelector('button[aria-label="设置"]').click()`)
    await run(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('缓存与索引')).click()`)
    await until(`document.body.innerText.includes('/fixture/current-cache')`)
    const click = `(()=>{const text=[...document.querySelectorAll('.path')].find(el=>el.textContent==='/fixture/current-cache');[...text.parentElement.querySelectorAll('button')].find(button=>button.textContent==='打开').click()})()`
    await run(click)
    await until(`window.wetrace.cacheOpens().then(value=>value===1)`)
    assert.equal(await run(`(()=>{const text=[...document.querySelectorAll('.path')].find(el=>el.textContent==='/fixture/current-cache');return [...text.parentElement.querySelectorAll('button')].some(button=>button.textContent==='更改')})()`), false)
    await run(`window.wetrace.cacheFixture(true)`); await run(click)
    await until(`document.body.innerText.includes('打开缓存目录失败')`)
    console.log('缓存目录界面测试通过：固定路径显示、打开目录、禁止外迁及失败提示')
    app.exit(0)
  } catch (error) { console.error(error); app.exit(1) }
  finally { window?.destroy() }
})
