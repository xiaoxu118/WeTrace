import fs from 'node:fs/promises'
import path from 'node:path'
import type { ReportHistoryItem } from '../shared/types'

const decode = (value: string) => value.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]!)
export async function listReportHistory(directory: string): Promise<ReportHistoryItem[]> {
  const folders = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw new Error('读取报告列表失败，请检查文稿目录权限')
  })
  const reports: ReportHistoryItem[] = []
  for (const folder of folders) {
    if (!folder.isDirectory() || !/^\d+-[a-z\d-]+$/i.test(folder.name)) continue
    const root = path.join(directory, folder.name)
    const htmlPath = path.join(root, 'report.html')
    try {
      const stat = await fs.lstat(htmlPath)
      if (!stat.isFile() || stat.isSymbolicLink()) continue
      let meta: Record<string, unknown> = {}
      try { const parsed = JSON.parse(await fs.readFile(path.join(root, 'report.json'), 'utf8')); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed } catch { /* Older exports have no metadata. */ }
      let title = ''
      let dates: string[] = []
      if (typeof meta.name !== 'string' || typeof meta.startDate !== 'string') {
        const file = await fs.open(htmlPath, 'r')
        try {
          const bytes = Buffer.alloc(64 * 1024)
          const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
          const head = bytes.subarray(0, bytesRead).toString('utf8')
          title = decode(/<title>([^<]*)<\/title>/i.exec(head)?.[1] || '').replace(/\s*·\s*[^·]*$/, '').trim()
          dates = [...head.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)].map(match => match[0])
        } finally { await file.close() }
      }
      const files = await fs.readdir(root, { withFileTypes: true })
      const pngPaths = files.filter(file => file.isFile() && /^report(?:-\d+)?\.png$/.test(file.name)).map(file => path.join(root, file.name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      const stamp = Number(folder.name.split('-')[0])
      reports.push({ id: folder.name, name: typeof meta.name === 'string' ? meta.name : title || '聊天报告',
        startDate: typeof meta.startDate === 'string' ? meta.startDate : dates[0] || '',
        endDate: typeof meta.endDate === 'string' ? meta.endDate : dates[1] || dates[0] || '',
        createdAt: Number.isFinite(stamp) && stamp > 0 ? stamp : stat.birthtimeMs,
        styleId: typeof meta.styleId === 'string' ? meta.styleId : undefined,
        styleName: typeof meta.styleName === 'string' ? meta.styleName : undefined,
        htmlPath, pngPaths })
    } catch { /* Skip removed, incomplete or unreadable exports without hiding other reports. */ }
  }
  return reports.sort((a, b) => b.createdAt - a.createdAt)
}
