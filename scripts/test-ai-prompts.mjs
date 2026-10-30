import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wetrace-prompts-'))
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`
const defaultsUrl = moduleUrl(fs.readFileSync(new URL('../src/main/ai-chat-prompts.ts', import.meta.url), 'utf8'))
const source = fs.readFileSync(new URL('../src/main/ai-prompt-store.ts', import.meta.url), 'utf8')
  .replace("import { app } from 'electron'", `const app = { getPath: () => ${JSON.stringify(directory)} }`)
  .replace("'./ai-chat-prompts'", JSON.stringify(defaultsUrl))
try {
  const { loadAiPrompts, saveAiPrompts, renderQueryPrompt } = await import(moduleUrl(source))
  const initial = loadAiPrompts()
  assert.equal(initial.styles.length, 1)
  assert.equal(initial.selectedStyleId, 'default')
  saveAiPrompts({ selectedStyleId: 'default', styles: [{ ...initial.styles[0], name: '修改名称', prompt: '修改提示词' }] })
  assert.deepEqual(loadAiPrompts().styles, initial.styles, 'default style must remain immutable')
  fs.writeFileSync(path.join(directory, 'ai-prompts.json'), JSON.stringify({ schemaVersion: 3, selectedStyleId: 'default', styles: [{ ...initial.styles[0], prompt: '旧的自定义默认提示词' }] }))
  assert.deepEqual(loadAiPrompts().styles, initial.styles, 'stored default style must use the built-in prompt')
  const originalRules = initial.current
  const custom = { id: 'my-style', name: '我的风格', prompt: '简短、幽默，使用小标题。' }
  saveAiPrompts({ selectedStyleId: custom.id, styles: [...initial.styles, custom], query: '更改查询', answer: '更改规则' })
  assert.equal(loadAiPrompts().selectedStyleId, custom.id)
  assert.deepEqual(loadAiPrompts().current, originalRules, 'style configuration must not replace task rules')
  assert.equal(loadAiPrompts().styles[1].prompt, custom.prompt)
  const renamed = loadAiPrompts().styles.map(style => style.id === custom.id ? { ...style, name: '新的名称', prompt: '温和直接。' } : style)
  saveAiPrompts({ selectedStyleId: custom.id, styles: renamed })
  assert.equal(loadAiPrompts().styles[1].name, '新的名称')
  saveAiPrompts({ selectedStyleId: 'default', styles: initial.styles })
  assert.equal(loadAiPrompts().styles.length, 1)
  assert.throws(() => saveAiPrompts({ selectedStyleId: 'default', styles: [] }))
  assert.throws(() => saveAiPrompts({ selectedStyleId: custom.id, styles: [custom] }), /默认风格不能删除/)
  assert.throws(() => saveAiPrompts({ selectedStyleId: 'missing', styles: initial.styles }), /有效/)
  assert.throws(() => saveAiPrompts({ selectedStyleId: 'default', styles: [...initial.styles, { ...custom, name: '默认风格' }] }), /名称不能重复/)
  assert.throws(() => saveAiPrompts({ selectedStyleId: 'default', styles: [{ ...initial.styles[0], prompt: 'x'.repeat(12001) }] }), /12000/)
  assert.equal(renderQueryPrompt('{{today}} {{timezone}}', '2026-10-30', 'Asia/Shanghai'), '2026-10-30 Asia/Shanghai')
  const legacy = { selectedStyleId: 'humorous', styles: { default: { query: '旧版查询', answer: '旧版完整提示词' }, humorous: { query: '旧版查询', answer: '旧版幽默提示词' } } }
  fs.writeFileSync(path.join(directory, 'ai-prompts.json'), JSON.stringify(legacy))
  assert.equal(loadAiPrompts().styles.length, 1)
  assert.deepEqual(loadAiPrompts().current, originalRules)
  saveAiPrompts({ selectedStyleId: 'default', styles: initial.styles })
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'ai-prompts.json.legacy.json'), 'utf8')), legacy)
  console.log('Styles: default only, custom CRUD, activation, validation, legacy backup and immutable task rules passed')
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
