import assert from 'node:assert/strict'
import { callReportModel } from '../src/main/report-model.ts'
const original = globalThis.fetch
const config = { apiFormat: 'openai', apiKey: 'test', baseUrl: 'https://example.invalid', model: 'test' }
const unavailable = status => new Response('{"error":{"code":"service_unavailable_error"}}', { status, headers: { 'Retry-After': '0', 'Content-Type': 'application/json' } })
const success = () => new Response('{"choices":[{"message":{"content":"成功"}}]}')
try {
  let calls = 0, retries = []
  globalThis.fetch = async () => ++calls < 3 ? unavailable(503) : success()
  assert.equal(await callReportModel(config, '问题', undefined, { onRetry: attempt => retries.push(attempt) }), '成功')
  assert.equal(calls, 3); assert.deepEqual(retries, [1, 2])
  calls = 0
  globalThis.fetch = async () => { calls++; return unavailable(503) }
  await assert.rejects(() => callReportModel(config, '问题'), /HTTP 503/)
  assert.equal(calls, 3)
  calls = 0
  globalThis.fetch = async () => { calls++; return unavailable(401) }
  await assert.rejects(() => callReportModel(config, '问题'), /HTTP 401/)
  assert.equal(calls, 1)
  calls = 0
  globalThis.fetch = async () => { calls++; return new Response('data: {"choices":[{"delta":{"content":"部分回答"}}]}\n\ndata: {"error":{"code":"service_unavailable_error"}}\n\n') }
  let text = ''
  await assert.rejects(() => callReportModel(config, '问题', undefined, { onDelta: delta => { text += delta } }), /流式响应失败/)
  assert.equal(calls, 1); assert.equal(text, '部分回答')
  calls = 0
  const controller = new AbortController()
  globalThis.fetch = async () => { calls++; return unavailable(503) }
  await assert.rejects(() => callReportModel(config, '问题', undefined, { signal: controller.signal, onRetry: () => controller.abort() }), /已停止/)
  assert.equal(calls, 1)
  console.log('Model retry: 503 recovery, retry bound, no 401 retry, no partial-stream replay and cancellation passed')
} finally { globalThis.fetch = original }
