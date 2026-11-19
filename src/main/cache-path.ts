import fs from 'node:fs'
import path from 'node:path'
import { applicationStorageRoot } from './storage-paths'
let activeDirectory: string | undefined
let activeIndexDirectory: string | undefined
export function getChatIndexDirectory(): string { return activeIndexDirectory ?? path.join(applicationStorageRoot(), 'data', 'chat-index') }
const configFile = () => path.join(applicationStorageRoot(), 'cache-location.json')
export function getCacheDirectory(): string { return activeDirectory ?? path.join(applicationStorageRoot(), 'cache') }
export function saveCacheDirectory(directory: string): void {
  if (!path.isAbsolute(directory)) throw new Error('请选择有效的缓存目录')
  fs.mkdirSync(directory, { recursive: true })
  fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK)
  const target = fs.realpathSync(directory), current = fs.realpathSync(getCacheDirectory())
  if (target !== current && (target.startsWith(current + path.sep) || current.startsWith(target + path.sep))) throw new Error('新旧缓存目录不能相互包含')
  const temporary = `${configFile()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify({ directory: target, indexDirectory: path.join(target, 'chat-index') }))
  fs.renameSync(temporary, configFile())
}
export function initializeCacheDirectory(): void {
  if (!fs.existsSync(configFile())) return
  const config = JSON.parse(fs.readFileSync(configFile(), 'utf8')) as { directory: string; indexDirectory?: string }
  if (!path.isAbsolute(config.directory)) throw new Error('缓存目录配置无效')
  fs.mkdirSync(config.directory, { recursive: true })
  fs.accessSync(config.directory, fs.constants.R_OK | fs.constants.W_OK)
  if (config.indexDirectory) {
    if (!path.isAbsolute(config.indexDirectory)) throw new Error('索引目录配置无效')
    fs.mkdirSync(config.indexDirectory, { recursive: true })
    fs.accessSync(config.indexDirectory, fs.constants.R_OK | fs.constants.W_OK)
    activeIndexDirectory = config.indexDirectory
  }
  activeDirectory = config.directory
}
