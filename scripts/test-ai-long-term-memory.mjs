import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AiLongTermMemoryStore } from '../src/main/ai-long-term-memory.ts'
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wetrace-memory-'))
try {
  let store = new AiLongTermMemoryStore(directory)
  const account = '/fictional/account-a'
  const saved = store.update(account, { type: 'add', content: '回答简洁，称呼我为小林' })
  assert.equal(saved.entries.length, 1)
  store = new AiLongTermMemoryStore(directory)
  assert.match(store.context(account), /回答简洁/)
  assert.equal(store.context('/fictional/account-b'), '')
  store.update(account, { type: 'enable', enabled: false })
  assert.equal(new AiLongTermMemoryStore(directory).context(account), '')
  store.update(account, { type: 'enable', enabled: true })
  store.update(account, { type: 'delete', id: saved.entries[0].id })
  assert.equal(store.context(account), '')
  store.update(account, { type: 'add', content: '优先使用中文' })
  store.update(account, { type: 'clear' })
  assert.equal(new AiLongTermMemoryStore(directory).context(account), '')
  assert.throws(() => store.update(account, { type: 'add', content: 'x'.repeat(501) }))
  assert.throws(() => store.update('', { type: 'load' }))
  store.update(account, { type: 'add', content: '虚构偏好' })
  for (const name of fs.readdirSync(directory)) fs.writeFileSync(path.join(directory, name), 'damaged')
  assert.throws(() => store.context(account), /保留原文件/)
  console.log('AI long-term memory tests passed')
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
