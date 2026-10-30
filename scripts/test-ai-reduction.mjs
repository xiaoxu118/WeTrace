import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
function moduleUrl(source) {
  const outputText = stripTypeScriptTypes(source)
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
}
const modelUrl = moduleUrl(fs.readFileSync(new URL('../src/main/report-model.ts', import.meta.url), 'utf8'))
const source = fs.readFileSync(new URL('../src/main/ai-chat-reduction.ts', import.meta.url), 'utf8').replace("'./report-model'", JSON.stringify(modelUrl))
const { reduceChatNotes } = await import(moduleUrl(source))
let calls = 0
const result = await reduceChatNotes(Array.from({ length: 80 }, (_, i) => `${i}: ${'内容'.repeat(4500)}`), async batch => {
  assert.ok(batch.length <= 18001)
  calls++
  return `摘要 ${calls}`
})
assert.ok(calls > 24)
assert.ok(result.length <= 18001)
const controller = new AbortController()
controller.abort()
await assert.rejects(() => reduceChatNotes(['x'.repeat(19000)], async () => '摘要', controller.signal), /abort/i)
await assert.rejects(() => reduceChatNotes(['x'.repeat(19000)], async () => 'y'.repeat(7000)), /摘要过长/)
console.log('AI reduction: more than 24 batches, bounded merge, cancellation and oversized summary passed')
