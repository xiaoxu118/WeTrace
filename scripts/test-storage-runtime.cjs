// Hidden Electron fixture, never starts the production main process or imports real user data.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { stripTypeScriptTypes } = Module
const root = path.resolve('.cache/storage-runtime-' + Date.now())
const installation = path.join(root, 'install')
fs.mkdirSync(installation, { recursive: true })
const compile = (source, filename) => { const m = new Module(filename, module); m.filename = filename; m.paths = module.paths; m._compile(source, filename); return m.exports }
const layoutSource = stripTypeScriptTypes(fs.readFileSync('src/main/storage-layout.ts', 'utf8')).replace("import fs from 'node:fs'", "const fs = require('node:fs')").replace("import path from 'node:path'", "const path = require('node:path')").replace('export function', 'function') + '\nmodule.exports = { createStorageLayout };'
globalThis.storageRuntimeFixture = {
  createStorageLayout: compile(layoutSource, path.join(root, 'layout.cjs')).createStorageLayout,
  app: new Proxy(app, { get(target, name) { if (name === 'isPackaged') return false; if (name === 'getAppPath') return () => installation; const value = target[name]; return typeof value === 'function' ? value.bind(target) : value } }),
}
const bootstrap = stripTypeScriptTypes(fs.readFileSync('src/main/storage-bootstrap.ts', 'utf8'))
  .replace("import { app, dialog } from 'electron'", "const { dialog } = require('electron'); const { app } = globalThis.storageRuntimeFixture")
  .replace("import path from 'node:path'", "const path = require('node:path')")
  .replace("import { createStorageLayout } from './storage-layout'", 'const { createStorageLayout } = globalThis.storageRuntimeFixture')
  .replace('export const previousStorage', 'const previousStorage')
compile(bootstrap, path.join(root, 'bootstrap.cjs'))
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  let window
  try {
    const storage = path.join(installation, 'WeTrace')
    for (const name of ['userData', 'appData', 'sessionData', 'logs', 'temp', 'crashDumps']) assert.ok(app.getPath(name).startsWith(storage), name)
    assert.equal(require('node:os').tmpdir(), path.join(storage, 'temp'))
    const page = path.join(storage, 'temp', 'fixture.html')
    fs.writeFileSync(page, '<!doctype html><title>storage fixture</title>')
    window = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    await window.loadFile(page)
    await window.webContents.executeJavaScript("localStorage.setItem('fixture', 'synthetic'); localStorage.getItem('fixture')")
    window.webContents.session.flushStorageData()
    assert.ok(fs.existsSync(path.join(storage, 'session', 'Local Storage')))
    console.log('Electron实际路径测试通过：用户配置、会话、localStorage、缓存、日志和临时目录均位于安装目录内')
    window.destroy(); app.exit(0)
  } catch (error) { console.error(error); window?.destroy(); app.exit(1) }
})
