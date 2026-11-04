import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
export interface WindowsNativeResources { directory: string; api: string; dependency: string; keyHelper: string; versions: string[] }
/** Provisioned files must match an explicit manifest; never silently pick an arbitrary DLL. */
export function windowsNativeResources(roots = [process.resourcesPath, path.join(process.cwd(), 'resources')].filter((root): root is string => Boolean(root))): WindowsNativeResources {
  for (const root of roots) {
    const directory = path.join(root, 'wcdb', 'windows', 'x64')
    const manifestFile = path.join(directory, 'manifest.json')
    if (!fs.existsSync(manifestFile)) continue
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as { schema: number; versions: string[]; files: Record<string, string> }
      if (manifest.schema !== 1 || !Array.isArray(manifest.versions) || !manifest.versions.length || manifest.versions.some(version => !/^4\.\d+\.\d+(?:\.\d+)?$/.test(version))) throw new Error('invalid manifest')
      for (const name of ['wcdb_api.dll', 'WCDB.dll', 'key-helper.exe']) {
        const expected = manifest.files[name]
        if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected) || createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex') !== expected) throw new Error('invalid resource')
      }
      return { directory, api: path.join(directory, 'wcdb_api.dll'), dependency: path.join(directory, 'WCDB.dll'), keyHelper: path.join(directory, 'key-helper.exe'), versions: manifest.versions }
    } catch { throw new Error('Windows 原生资源清单或文件校验失败，未加载组件') }
  }
  throw new Error('Windows 微信连接尚未开放：缺少已校验的 WCDB x64 DLL、密钥获取工具和微信 4.x 基线版本清单')
}
