// Must be the first main-process import, before any module resolves writable paths.
import { app, dialog } from 'electron'
import path from 'node:path'
import { createStorageLayout } from './storage-layout'

const appPath = app.getAppPath()
export const previousStorage = { userData: app.getPath('userData'), appData: app.getPath('appData'), documents: app.getPath('documents') }
const installation = app.isPackaged
  ? process.platform === 'darwin' ? path.resolve(path.dirname(process.execPath), '../../..') : path.dirname(process.execPath)
  : appPath
try {
  const storage = createStorageLayout(installation)
  process.env.WETRACE_STORAGE_ROOT = storage.root
  process.env.WETRACE_APP_PATH = appPath
  process.env.TEMP = storage.temp
  process.env.TMP = storage.temp
  process.env.TMPDIR = storage.temp
  process.env.APPDATA = storage.data
  process.env.LOCALAPPDATA = storage.data
  process.chdir(storage.root)
  app.setPath('appData', storage.data)
  app.setPath('userData', storage.data)
  app.setPath('sessionData', storage.session)
  app.setPath('temp', storage.temp)
  app.setPath('crashDumps', storage.crashes)
  app.setAppLogsPath(storage.logs)
  app.commandLine.appendSwitch('disk-cache-dir', path.join(storage.session, 'Cache'))
  app.commandLine.appendSwitch('log-file', path.join(storage.logs, 'chromium.log'))
} catch (error) {
  dialog.showErrorBox('无法创建应用数据目录', `无法写入 ${path.join(installation, 'WeTrace')}。${process.platform === 'darwin' ? '请先将应用从 DMG 拖到可写的安装目录；移动应用时请同时移动旁边的 WeTrace 数据文件夹。' : '请将 WeTrace 安装到可写目录后重试；macOS 请先将应用移出 DMG，移动应用时同时移动旁边的 WeTrace 数据文件夹。'}${error instanceof Error ? error.message : ''}`)
  app.exit(1)
  throw error
}
