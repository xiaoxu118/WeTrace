import fs from 'node:fs'
import path from 'node:path'

export function createStorageLayout(installationDirectory: string) {
  const installation = fs.realpathSync.native(installationDirectory)
  const root = path.join(installation, 'WeTrace')
  const layout = { root, data: path.join(root, 'data'), cache: path.join(root, 'cache'), session: path.join(root, 'session'), temp: path.join(root, 'temp'), logs: path.join(root, 'logs'), crashes: path.join(root, 'crash-dumps'), reports: path.join(root, 'reports') }
  for (const directory of Object.values(layout)) {
    fs.mkdirSync(directory, { recursive: true })
    if (fs.realpathSync.native(directory).toLowerCase() !== path.resolve(directory).toLowerCase()) throw new Error('应用数据目录不能链接到安装目录之外')
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK)
  }
  const probe = path.join(root, `.write-check-${process.pid}`)
  fs.writeFileSync(probe, '', { flag: 'wx' }); fs.unlinkSync(probe)
  return layout
}
