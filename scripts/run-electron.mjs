import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { cleanElectronEnvironment } from './electron-environment.mjs'

const require = createRequire(import.meta.url)
const [command, ...args] = process.argv.slice(2)
let executable
let childArgs
if (command === 'dev' || command === 'preview' || command === 'build') {
  const manifestPath = require.resolve('electron-vite/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  executable = process.execPath
  childArgs = [path.resolve(path.dirname(manifestPath), manifest.bin['electron-vite']), command, ...args]
} else if (command === 'exec') {
  executable = require('electron')
  childArgs = args
} else {
  console.error('Usage: node scripts/run-electron.mjs <dev|preview|build|exec> [args]')
  process.exit(1)
}
const child = spawn(executable, childArgs, { stdio: 'inherit', env: cleanElectronEnvironment(), windowsHide: false })
child.once('error', error => { console.error(error.message); process.exitCode = 1 })
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (child.exitCode === null) child.kill(signal) })
