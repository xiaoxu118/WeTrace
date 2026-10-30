// Exercise the native cursor/ImageIO path from the reported crash, without chat data.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  if (process.platform !== 'darwin') { console.log('macOS cursor test skipped on this platform'); return }
  if (!process.argv.includes('--unsafe-repro')) assert.equal(Object.keys(process.env).some(key => key.startsWith('DYLD_')), false)
  const koffi = require('koffi')
  const objc = koffi.load('/usr/lib/libobjc.A.dylib')
  const getClass = objc.func('void* objc_getClass(const char* name)')
  const selector = objc.func('void* sel_registerName(const char* name)')
  const send = objc.func('void* objc_msgSend(void* receiver, void* selector)')
  const set = objc.func('void objc_msgSend(void* receiver, void* selector)')
  const cursor = getClass('NSCursor')
  assert.ok(cursor)
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await window.loadURL('data:text/html,<button style="cursor:pointer">选择会话</button><input>')
    for (let iteration = 0; iteration < 5; iteration++) {
      for (const name of ['arrowCursor', 'pointingHandCursor', 'IBeamCursor', 'operationNotAllowedCursor', 'openHandCursor', 'crosshairCursor']) {
        const instance = send(cursor, selector(name))
        assert.ok(instance)
        set(instance, selector('set'))
      }
    }
    set(send(cursor, selector('arrowCursor')), selector('set'))
    console.log('macOS 原生指针测试通过：箭头、手形、文本、禁用等 30 次切换未崩溃。')
  } finally { window.destroy() }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
