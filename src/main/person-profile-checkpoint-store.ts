import { app, safeStorage } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deserialize, serialize } from 'node:v8'
import type { ProfileCheckpoint } from './person-profile-pipeline'

const version = 5

function checkpointPath(identity: string): string {
  const id = createHash('sha256').update(identity).digest('hex')
  return join(app.getPath('userData'), 'profile-checkpoints', `${id}.bin`)
}

export function loadProfileCheckpoint(identity: string, modelKey: string): ProfileCheckpoint | undefined {
  try {
    if (!safeStorage.isEncryptionAvailable()) return undefined
    const encrypted = readFileSync(checkpointPath(identity))
    const saved = deserialize(Buffer.from(safeStorage.decryptString(encrypted), 'base64')) as {
      version: number; modelKey: string; checkpoint: ProfileCheckpoint
    }
    if (saved.version === version && saved.modelKey === modelKey) return saved.checkpoint
  } catch { /* Missing or unreadable data can be rebuilt by a new attempt. */ }
  return undefined
}

export function saveProfileCheckpoint(identity: string, modelKey: string, checkpoint: ProfileCheckpoint): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用')
  const file = checkpointPath(identity)
  const temporary = `${file}.tmp`
  mkdirSync(join(app.getPath('userData'), 'profile-checkpoints'), { recursive: true, mode: 0o700 })
  try {
    const content = serialize({ version, modelKey, checkpoint }).toString('base64')
    writeFileSync(temporary, safeStorage.encryptString(content), { mode: 0o600 })
    renameSync(temporary, file)
  } finally {
    try { unlinkSync(temporary) } catch { /* A successful rename removes the temporary file. */ }
  }
}

export function removeProfileCheckpoint(identity: string): void {
  try { unlinkSync(checkpointPath(identity)) }
  catch { /* The checkpoint may not exist. */ }
}
