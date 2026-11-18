// Install explicitly supplied native components; does not execute them.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { windowsExports } from './windows-pe.mjs'
const input = process.argv[2]
if (!input) throw new Error('用法：node scripts/prepare-windows-resources.mjs <TraceMemo源码目录>')
const destination = path.resolve('resources/wcdb/windows/x64')
fs.mkdirSync(destination, { recursive: true })
const files = {}
for (const name of ['WCDB.dll', 'wx_key.dll']) {
  const flat = path.join(input, name)
  const source = fs.existsSync(flat) ? flat : path.join(input, 'resources', name === 'wx_key.dll' ? 'key' : 'wcdb', 'win32', 'x64', name)
  const data = fs.readFileSync(source)
  if (data.toString('ascii', 0, 2) !== 'MZ') throw new Error(`无效的Windows组件：${name}`)
  fs.writeFileSync(path.join(destination, name), data)
  windowsExports(path.join(destination, name))
  files[name] = createHash('sha256').update(data).digest('hex')
}
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ schema: 1, versions: ['4.1.9.57'], files }, null, 2) + '\n')
console.log('Windows组件已复制并生成校验清单；请运行 pnpm test:local:windows 检查原生接口')
