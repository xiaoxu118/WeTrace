import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
export interface WindowsNativeResources { directory: string; dependency: string; keyDll: string; versions: string[]; libraries: string[] }
/** Provisioned files must match an explicit manifest; never silently pick an arbitrary DLL. */
export function windowsNativeResources(roots = [process.resourcesPath, path.join(process.env.WETRACE_APP_PATH || process.cwd(), 'resources')].filter((root): root is string => Boolean(root))): WindowsNativeResources {
  for (const root of roots) {
    const directory = path.join(root, 'wcdb', 'windows', 'x64')
    const manifestFile = path.join(directory, 'manifest.json')
    if (!fs.existsSync(manifestFile)) continue
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as { schema: number; versions: string[]; files: Record<string, string> }
      if (manifest.schema !== 1 || !Array.isArray(manifest.versions) || !manifest.versions.length || manifest.versions.some(version => !/^4\.\d+\.\d+(?:\.\d+)?$/.test(version))) throw new Error('invalid manifest')
      for (const name of ['WCDB.dll', 'wx_key.dll', ...Object.keys(manifest.files)]) {
        if (!/^[a-zA-Z0-9_.-]+\.dll$/.test(name)) throw new Error('invalid resource name')
        const expected = manifest.files[name]
        if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected) || createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex') !== expected) throw new Error('invalid resource')
      }
      return { directory, dependency: path.join(directory, 'WCDB.dll'), keyDll: path.join(directory, 'wx_key.dll'), versions: manifest.versions, libraries: Object.keys(manifest.files).map(name => path.join(directory, name)) }
    } catch { throw new Error('Windows 原生资源清单或文件校验失败，未加载组件') }
  }
  throw new Error('缺少 Windows x64 数据库组件、密钥 DLL 或微信版本清单，请重新安装完整版本')
}
