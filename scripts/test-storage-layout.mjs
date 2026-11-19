// Only synthetic workspace directories; never reads the user's application profile.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'
import { createStorageLayout } from '../src/main/storage-layout.ts'
import { migrateLegacyStorage } from '../src/main/storage-migration.ts'
const originalCwd = process.cwd(), originalEnvironment = { ...process.env }
const originalExecutable = process.execPath
const root = path.resolve('.cache', `storage-test-${randomUUID()}`)
fs.mkdirSync(root, { recursive: true })
try {
  const installation = path.join(root, '安装目录'); fs.mkdirSync(installation)
  const layout = createStorageLayout(installation)
  for (const value of Object.values(layout)) assert.ok(value.startsWith(path.join(installation, 'WeTrace')))
  const write = fs.writeFileSync
  try {
    fs.writeFileSync = () => { throw Object.assign(new Error('fixture permission denied'), { code: 'EACCES' }) }
    assert.throws(() => createStorageLayout(installation), /permission denied/)
  } finally { fs.writeFileSync = write }
  const old = { userData: path.join(root, 'old-profile'), appData: path.join(root, 'old-appdata'), documents: path.join(root, 'old-documents') }
  fs.mkdirSync(path.join(old.userData, 'database-keys'), { recursive: true })
  fs.writeFileSync(path.join(old.userData, 'database-keys/fictional.bin'), 'synthetic-encrypted-key')
  fs.writeFileSync(path.join(old.userData, 'Local State'), '{"synthetic-key-metadata":true}')
  fs.mkdirSync(path.join(old.userData, 'Local Storage'), { recursive: true })
  fs.writeFileSync(path.join(old.userData, 'Local Storage/fictional'), 'synthetic-settings')
  const externalCache = path.join(root, 'old-custom-cache'); fs.mkdirSync(externalCache)
  fs.writeFileSync(path.join(externalCache, 'fictional.json'), '{"synthetic":true}')
  fs.writeFileSync(path.join(old.userData, 'cache-directory.json'), JSON.stringify({ directory: externalCache }))
  fs.mkdirSync(path.join(old.documents, 'WeTrace Reports'), { recursive: true })
  fs.writeFileSync(path.join(old.documents, 'WeTrace Reports/fictional.html'), 'synthetic-report')
  await migrateLegacyStorage(layout.root, old)
  assert.equal(fs.readFileSync(path.join(layout.data, 'database-keys/fictional.bin'), 'utf8'), 'synthetic-encrypted-key')
  assert.equal(fs.readFileSync(path.join(layout.cache, 'fictional.json'), 'utf8'), '{"synthetic":true}')
  assert.equal(fs.readFileSync(path.join(layout.session, 'Local Storage/fictional'), 'utf8'), 'synthetic-settings')
  assert.equal(fs.existsSync(path.join(layout.data, 'Local State')), true)
  assert.equal(fs.existsSync(path.join(layout.data, 'cache-directory.json')), false)
  assert.equal(fs.existsSync(path.join(layout.reports, 'fictional.html')), true)
  assert.equal(fs.existsSync(path.join(old.userData, 'database-keys/fictional.bin')), true)
  fs.writeFileSync(path.join(layout.data, 'database-keys/fictional.bin'), 'updated')
  await migrateLegacyStorage(layout.root, old)
  assert.equal(fs.readFileSync(path.join(layout.data, 'database-keys/fictional.bin'), 'utf8'), 'updated')
  fs.writeFileSync(path.join(old.userData, 'database-keys/recovered.bin'), 'synthetic-recovered')
  await migrateLegacyStorage(layout.root, old)
  assert.equal(fs.readFileSync(path.join(layout.data, 'database-keys/recovered.bin'), 'utf8'), 'synthetic-recovered')
  assert.equal(fs.readFileSync(path.join(layout.data, 'database-keys/fictional.bin'), 'utf8'), 'updated')
  const overridden = new Map(), switches = new Map()
  globalThis.storageFixture = {
    app: { isPackaged: false, getAppPath: () => installation, getPath: name => old[name], setPath: (name, value) => overridden.set(name, value), setAppLogsPath: value => overridden.set('logs', value), commandLine: { appendSwitch: (name, value) => switches.set(name, value) }, exit: () => { throw new Error('unexpected app exit') } },
    dialog: { showErrorBox: () => {} }, createStorageLayout,
  }
  let source = fs.readFileSync('src/main/storage-bootstrap.ts', 'utf8')
  source = source.replace("import { app, dialog } from 'electron'", 'const { app, dialog } = globalThis.storageFixture')
    .replace("import { createStorageLayout } from './storage-layout'", 'const { createStorageLayout } = globalThis.storageFixture')
  await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'))
  for (const name of ['appData', 'userData', 'sessionData', 'temp', 'crashDumps', 'logs']) assert.ok(overridden.get(name).startsWith(layout.root))
  for (const name of ['TEMP', 'TMP', 'TMPDIR']) assert.equal(process.env[name], layout.temp)
  assert.equal(process.cwd(), layout.root)
  assert.ok(switches.get('disk-cache-dir').startsWith(layout.session))
  assert.ok(switches.get('log-file').startsWith(layout.logs))
  globalThis.storageFixture.app.isPackaged = true
  globalThis.storageFixture.app.getAppPath = () => path.join(installation, 'resources', 'app.asar')
  process.execPath = process.platform === 'darwin'
    ? path.join(installation, 'WeTrace.app', 'Contents', 'MacOS', 'WeTrace')
    : path.join(installation, 'WeTrace.exe')
  await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source) + '\n// packaged fixture').toString('base64'))
  assert.equal(process.env.WETRACE_STORAGE_ROOT, layout.root, '安装包按exe位置定位，不能使用启动时的工作目录')
  console.log('安装目录存储测试通过：全部运行路径、环境变量、浏览器缓存、旧数据导入、缓存归位和原文件保留')
} finally {
  process.chdir(originalCwd)
  process.execPath = originalExecutable
  for (const name of Object.keys(process.env)) if (!(name in originalEnvironment)) delete process.env[name]
  Object.assign(process.env, originalEnvironment)
  delete globalThis.storageFixture
  fs.rmSync(root, { recursive: true, force: true })
}
