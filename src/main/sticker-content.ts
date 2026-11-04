import fs from 'node:fs'
import path from 'node:path'

// Search only known media folders under this account, never paths or URLs from message XML.
export function localStickerLookup(root: string): (hash: string) => string[] {
  let months: string[] | undefined
  let directories: string[] | undefined
  const memo = new Map<string, string[]>()
  return (hash: string): string[] => {
    if (!/^[a-f\d]{32}$/i.test(hash)) return []
    hash = hash.toLowerCase()
    if (memo.has(hash)) return memo.get(hash)!
    if (!directories) {
      directories = []
      const visit = (directory: string, depth: number): void => {
        if (depth > 4 || directories!.length >= 512) return
        let entries: fs.Dirent[]
        try {
          if (!fs.lstatSync(directory).isDirectory()) return
          entries = fs.readdirSync(directory, { withFileTypes: true })
        } catch { return }
        directories!.push(directory)
        for (const entry of entries) if (entry.isDirectory()) visit(path.join(directory, entry.name), depth + 1)
      }
      for (const folder of ['emoji', 'emoticon', 'Emoticon', 'sticker', 'msg/emoji', 'msg/emoticon', 'FileStorage/Emotion', 'FileStorage/Emoticon', 'FileStorage/CustomEmotion']) visit(path.join(root, folder), 0)
    }
    const files: string[] = []
    // WeChat 4.x stores downloaded stickers without an extension, grouped by month and hash prefix.
    if (!months) {
      try { months = fs.readdirSync(path.join(root, 'cache')).filter(name => /^\d{4}-\d{2}$/.test(name)).sort().reverse() }
      catch { months = [] }
    }
    for (const month of months) {
      const folder = path.join(root, 'cache', month, 'Emoticon', hash.slice(0, 2))
      try {
        const real = fs.realpathSync(folder), base = fs.realpathSync(root)
        if (!real.startsWith(`${base}${path.sep}`)) continue
        const file = path.join(folder, hash), stat = fs.lstatSync(file)
        if (stat.isFile() && stat.size <= 20 * 1024 * 1024) files.push(file)
      } catch { /* This month's cache does not contain the sticker. */ }
    }
    for (const directory of directories) {
      for (const suffix of ['', '.gif', '.png', '.webp', '.jpg', '.jpeg', '.dat']) {
        const file = path.join(directory, `${hash}${suffix}`)
        try {
          const stat = fs.lstatSync(file)
          if (stat.isFile() && stat.size <= 20 * 1024 * 1024) files.push(file)
        } catch { /* Not downloaded in this folder. */ }
      }
    }
    memo.set(hash, files)
    return files
  }
}
