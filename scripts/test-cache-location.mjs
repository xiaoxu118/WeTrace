// Synthetic directories only; never touches the user's configured cache.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { pathToFileURL } from 'node:url'
const root = fs.mkdtempSync(path.resolve('.cache/cache-location-'))
const previous = process.env.WETRACE_STORAGE_ROOT
try {
  process.env.WETRACE_STORAGE_ROOT = root
  fs.mkdirSync(path.join(root, 'cache'))
  const source = stripTypeScriptTypes(fs.readFileSync('src/main/cache-path.ts', 'utf8')).replace("'./storage-paths'", JSON.stringify(pathToFileURL(path.resolve('src/main/storage-paths.ts')).href))
  const load = suffix => import('data:text/javascript;base64,' + Buffer.from(source + `\n// ${suffix}`).toString('base64'))
  const cache = await load('first')
  assert.equal(cache.getCacheDirectory(), path.join(root, 'cache'))
  assert.throws(() => cache.saveCacheDirectory('relative'), /有效/)
  assert.throws(() => cache.saveCacheDirectory(path.join(root, 'cache', 'nested')), /包含/)
  const destination = path.join(root, 'new-cache')
  cache.saveCacheDirectory(destination)
  assert.equal(cache.getCacheDirectory(), path.join(root, 'cache'), '当前进程保持原缓存路径')
  const restarted = await load('restart')
  restarted.initializeCacheDirectory()
  assert.equal(restarted.getCacheDirectory(), destination)
  fs.writeFileSync(path.join(destination, 'fixture'), 'synthetic')
  restarted.saveCacheDirectory(destination)
  assert.equal(fs.readFileSync(path.join(destination, 'fixture'), 'utf8'), 'synthetic')
  assert.equal(restarted.getChatIndexDirectory(), path.join(destination, 'chat-index'))
  console.log('缓存路径回归通过：默认路径、非法路径、嵌套拒绝、重启生效及非空保护')
} finally {
  if (previous === undefined) delete process.env.WETRACE_STORAGE_ROOT
  else process.env.WETRACE_STORAGE_ROOT = previous
  fs.rmSync(root, { recursive: true, force: true })
}
