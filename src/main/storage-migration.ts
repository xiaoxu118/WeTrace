import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** Non-destructive import: only the installation directory is written. */
export function migrateLegacyStorage(root: string, previous: { userData: string; appData: string; documents: string }): void {
  const marker = path.join(root, 'storage-initialized.json')
  if (fs.existsSync(marker)) return
  let cache = path.join(previous.userData, 'cache')
  const config = path.join(previous.userData, 'cache-directory.json')
  if (fs.existsSync(config)) {
    const settings = JSON.parse(fs.readFileSync(config, 'utf8')) as { directory?: string }
    if (settings.directory && path.isAbsolute(settings.directory)) cache = settings.directory
  }
  const sources = [
    { source: previous.userData, name: 'data' },
    { source: previous.userData, name: 'session' },
    { source: cache, name: 'cache' },
    { source: path.join(previous.documents, 'WeTrace Reports'), name: 'reports' },
    { source: path.join(previous.appData, 'WeTrace', 'ai-conversations'), name: 'data/ai-conversations' },
    { source: path.join(previous.appData, 'WeTrace', 'ai-long-term-memory'), name: 'data/ai-long-term-memory' },
  ]
  for (const { source, name } of sources) {
    const target = path.join(root, name)
    fs.mkdirSync(target, { recursive: true })
    if (!fs.existsSync(source) || fs.readdirSync(target).length || path.resolve(source).toLowerCase() === path.resolve(target).toLowerCase()) continue
    const stage = path.join(root, `.import-${randomUUID()}`)
    try {
      fs.cpSync(source, stage, { recursive: true, filter: file => {
        if (fs.lstatSync(file).isSymbolicLink()) return false
        const part = path.relative(source, file).split(path.sep)[0].toLowerCase()
        const sessionEntries = ['local storage', 'session storage', 'indexeddb', 'network', 'preferences', 'secure preferences', 'cookies', 'local state']
        if (name === 'data' && ['cache-directory.json', 'cache', 'gpucache', 'code cache', 'dawnwebgpucache', 'dawngraphitecache', ...sessionEntries.filter(name => name !== 'local state')].includes(part)) return false
        if (name === 'session' && part && !sessionEntries.includes(part)) return false
        return true
      } })
      fs.rmdirSync(target)
      fs.renameSync(stage, target)
    } finally { if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true }) }
  }
  fs.writeFileSync(marker, JSON.stringify({ schema: 1 }), { flag: 'wx' })
}
