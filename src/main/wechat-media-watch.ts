import fs from 'node:fs'
import path from 'node:path'

/** Notice completed/renamed downloads as well as database changes. Owns every watcher it adds. */
export function watchWechatMedia(root: string, changed: (path?: string) => void): { close(): void } {
  const watchers = new Map<string, fs.FSWatcher>()
  let closed = false
  function watchFolder(folder: string): void {
    const target = path.join(root, folder)
    if (closed || watchers.has(target) || !fs.existsSync(target)) return
    try {
      const watcher = fs.watch(target, { recursive: true }, (_event, filename) => { if (!closed) changed(filename ? path.join(folder, String(filename)) : undefined) })
      watcher.on('error', () => { watcher.close(); watchers.delete(target) })
      watchers.set(target, watcher)
    } catch { /* Periodic sync remains available when recursive watching is unsupported. */ }
  }
  const refresh = (): void => { watchFolder('msg'); watchFolder('FileStorage') }
  refresh()
  try {
    const watcher = fs.watch(root, (_event, filename) => {
      if (!closed && (!filename || ['msg', 'FileStorage'].includes(String(filename)))) {
        for (const folder of ['msg', 'FileStorage']) {
          if (filename && String(filename) !== folder) continue
          const target = path.join(root, folder)
          watchers.get(target)?.close(); watchers.delete(target)
        }
        refresh(); changed()
      }
    })
    watcher.on('error', () => watcher.close())
    watchers.set(root, watcher)
  } catch { /* Account directories may disappear during logout. */ }
  return { close() { closed = true; for (const watcher of watchers.values()) watcher.close(); watchers.clear() } }
}
