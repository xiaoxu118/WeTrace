import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import { normalizeKey, isValidDatabaseKey } from '../shared/database-key-format'
export { isValidDatabaseKey } from '../shared/database-key-format'

export interface StoredDatabaseKey {
  key: string
  legacy: boolean
  createdAt: string | null
}

function directory(): string {
  return path.join(app.getPath('userData'), 'database-keys')
}

function keyFile(accountRoot: string): string {
  const normalizedRoot = path.resolve(accountRoot).toLowerCase()
  const id = createHash('sha256').update(normalizedRoot).digest('hex')
  return path.join(directory(), `${id}.bin`)
}

function legacyEncryptedFile(): string {
  return path.join(app.getPath('userData'), 'wechat-db-key.bin')
}

function legacyJsonFiles(): string[] {
  return [
    path.join(app.getPath('userData'), 'key.json'),
    path.join(app.getPath('userData'), 'wechat', 'key.json'),
    path.join(process.cwd(), '.cache', 'wechat', 'key.json'),
  ]
}

function createdAt(file: string): string | null {
  try {
    const stat = fs.statSync(file)
    return (stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime).toISOString()
  } catch {
    return null
  }
}

function decrypt(file: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用')
  const key = normalizeKey(safeStorage.decryptString(fs.readFileSync(file)))
  if (!isValidDatabaseKey(key)) throw new Error('保存的数据库密钥格式无效')
  return key
}

export function saveDatabaseKey(accountRoot: string, rawKey: string): void {
  const key = normalizeKey(rawKey)
  if (!isValidDatabaseKey(key)) throw new Error('数据库密钥必须是 64 位十六进制字符')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用')

  fs.mkdirSync(directory(), { recursive: true, mode: 0o700 })
  const target = keyFile(accountRoot)
  const temporary = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temporary, safeStorage.encryptString(key), { mode: 0o600 })
  fs.renameSync(temporary, target)
  fs.chmodSync(target, 0o600)
}

export function loadDatabaseKey(accountRoot: string): StoredDatabaseKey | null {
  const current = keyFile(accountRoot)
  if (fs.existsSync(current)) {
    return { key: decrypt(current), legacy: false, createdAt: createdAt(current) }
  }

  const legacyEncrypted = legacyEncryptedFile()
  if (fs.existsSync(legacyEncrypted)) {
    return { key: decrypt(legacyEncrypted), legacy: true, createdAt: createdAt(legacyEncrypted) }
  }

  for (const file of legacyJsonFiles()) {
    if (!fs.existsSync(file)) continue
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        key?: string
        accountRoot?: string
        createdAt?: string
      }
      if (saved.accountRoot && path.resolve(saved.accountRoot) !== path.resolve(accountRoot)) continue
      if (!saved.key || !isValidDatabaseKey(saved.key)) continue
      return {
        key: normalizeKey(saved.key),
        legacy: true,
        createdAt: saved.createdAt ?? createdAt(file),
      }
    } catch {
      // 忽略损坏的旧密钥文件，继续检查其他位置。
    }
  }
  return null
}

export function clearLegacyDatabaseKeys(): void {
  fs.rmSync(legacyEncryptedFile(), { force: true })
  for (const file of legacyJsonFiles()) fs.rmSync(file, { force: true })
}
