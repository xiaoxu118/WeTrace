import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const require = createRequire(import.meta.url)
const temporary = mkdtempSync(path.resolve('.cache/launch-test-'))
const marker = path.join(tmpdir(), `wetrace-clean-launch-${process.pid}.json`)
try {
  writeFileSync(path.join(temporary, 'guard.mjs'), stripTypeScriptTypes(readFileSync('src/main/startup-environment.ts', 'utf8')))
  writeFileSync(path.join(temporary, 'fixture.mjs'), `
import { app } from 'electron'
import { writeFileSync, appendFileSync } from 'node:fs'
import { relaunchWithoutLibraryOverrides } from './guard.mjs'
appendFileSync(${JSON.stringify(marker + '.trace')}, JSON.stringify({ argv: process.argv, exec: process.execPath, overrideNames: Object.keys(process.env).filter(key => key.startsWith('DYLD_')) }) + '\\n')
if (await relaunchWithoutLibraryOverrides()) app.exit(0)
app.whenReady().then(() => {
writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ clean: !Object.keys(process.env).some(key => key.startsWith('DYLD_')), preserved: process.env.WETRACE_LAUNCH_TEST }))
app.exit(0)
})
`)
  const result = spawnSync(require('electron'), [path.join(temporary, 'fixture.mjs')], { env: { ...process.env, DYLD_LIBRARY_PATH: '/opt/homebrew/lib', WETRACE_LAUNCH_TEST: 'kept' }, timeout: 15000, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || String(result.error))
  for (let i = 0; i < 100 && !existsSync(marker); i++) await new Promise(resolve => setTimeout(resolve, 50))
  assert.ok(existsSync(marker), '重新启动的 Electron 应完成启动: ' + (existsSync(marker + '.trace') ? readFileSync(marker + '.trace', 'utf8') : result.stderr))
  assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), { clean: true, preserved: 'kept' })
  console.log('直接启动保护测试通过：继承 Homebrew 动态库覆盖时自动干净重启，业务环境仍保留。')
} finally { rmSync(temporary, { recursive: true, force: true }); rmSync(marker, { force: true }); rmSync(marker + '.trace', { force: true }) }
