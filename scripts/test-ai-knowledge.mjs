import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wetrace-knowledge-'))
function url(source) { return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}` }
const shared = url(fs.readFileSync(new URL('../src/shared/ai-knowledge.ts', import.meta.url), 'utf8'))
const source = fs.readFileSync(new URL('../src/main/ai-knowledge.ts', import.meta.url), 'utf8')
  .replace("import { app } from 'electron'", `const app = { getPath: () => ${JSON.stringify(directory)} }`)
  .replace("'../shared/ai-knowledge'", JSON.stringify(shared))
  .replace("import { fetchMcpHotspots } from './hotspot-mcp'", "const fetchMcpHotspots = async () => { throw new Error('offline') }")
try {
  const { loadAiKnowledge, saveAiKnowledge, getHotspots } = await import(url(source))
  const defaults = loadAiKnowledge()
  assert.ok(defaults.memes.length > 0)
  assert.equal(defaults.hotspot.enabled, false)
  assert.equal(defaults.hotspot.url, '')
  assert.deepEqual(await getHotspots(true), { text: '', fetchedAt: '', cached: false })
  assert.throws(() => saveAiKnowledge({ ...defaults, hotspot: { ...defaults.hotspot, enabled: true } }), /服务地址/)
  const entry = { id: 'custom', phrase: '自己的梗', meaning: '测试', example: '例句', tags: ['测试'] }
  const saved = saveAiKnowledge({ ...defaults, memes: [entry] })
  assert.deepEqual(loadAiKnowledge(), saved)
  assert.throws(() => saveAiKnowledge({ ...saved, hotspot: { ...saved.hotspot, url: 'file:///etc/passwd' } }))
  assert.throws(() => saveAiKnowledge({ ...saved, hotspot: { ...saved.hotspot, argumentsJson: '[]' } }))
  assert.throws(() => saveAiKnowledge({ ...saved, memes: [{ ...entry, phrase: '' }] }))
  assert.equal((await getHotspots()).text, '')
  const configured = saveAiKnowledge({ ...saved, hotspot: { ...saved.hotspot, url: 'https://example.invalid/mcp' } })
  assert.match((await getHotspots(true)).error, /本地热梗库/)
  fs.writeFileSync(path.join(directory, 'ai-hotspots.json'), JSON.stringify({ key: JSON.stringify(configured.hotspot), fetchedAt: new Date().toISOString(), text: '缓存热点' }))
  assert.equal((await getHotspots(true)).text, '缓存热点')
  console.log('Knowledge: defaults, CRUD persistence, validation, disabled mode, offline fallback and cache passed')
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
