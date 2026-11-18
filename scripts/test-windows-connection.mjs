// Synthetic hook and paths only; never loads a DLL or accesses WeChat.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
let source = fs.readFileSync('src/main/windows-key-capture.ts', 'utf8')
source = source.replace("import koffi from 'koffi'", 'const koffi = {}').replace("import { isValidDatabaseKey } from '../shared/database-key-format'", 'const isValidDatabaseKey = key => /^[a-f0-9]{64}$/i.test(key)')
const { pollWindowsKey } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'))
let cleaned = 0, ready = 0, polls = 0
const hook = { initialize: () => true, cleanup: () => { cleaned++; return true }, poll: buffer => { polls++; buffer.write(polls === 1 ? 'invalid' : 'A'.repeat(64)); return true } }
assert.equal(await pollWindowsKey(hook, 123, () => ready++), 'a'.repeat(64))
assert.equal(ready, 1); assert.equal(cleaned, 1); assert.equal(polls, 2)
await assert.rejects(pollWindowsKey({ ...hook, initialize: () => false }, 123), /权限/)
await assert.rejects(pollWindowsKey(hook, 123, undefined, 0), /超时/)
assert.equal(cleaned, 3)
console.log('Windows密钥轮询、超时清理、无效密钥拒绝测试通过')
