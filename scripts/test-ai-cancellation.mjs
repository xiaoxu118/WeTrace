// Real HTTP cancellation against a local fixture; no model provider or private data is used.
import assert from 'node:assert/strict'
import http from 'node:http'
import { callReportModel } from '../src/main/report-model.ts'

let onRequest = () => {}, onClose = () => {}
let requests = 0
const server = http.createServer(async (request, response) => {
  let payload = ''
  for await (const chunk of request) payload += chunk
  const { model } = JSON.parse(payload)
  requests++
  response.on('close', () => onClose())
  if (model === 'stream') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write('data: {"choices":[{"delta":{"content":"开始"}}]}\n\n')
  } else if (model === 'retry') {
    response.writeHead(503)
    response.end('{}')
  }
  onRequest()
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = { apiFormat: 'openai', baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'fixture' }
const bounded = promise => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('取消超时')), 2000); timer.unref() })])
try {
  for (const model of ['waiting', 'stream']) {
    const controller = new AbortController()
    const received = new Promise(resolve => { onRequest = resolve })
    const closed = new Promise(resolve => { onClose = resolve })
    let delta = 0
    const pending = callReportModel({ ...base, model }, 'test', undefined, { signal: controller.signal, ...(model === 'stream' ? { onDelta: () => { delta++ } } : {}) })
    const rejected = assert.rejects(pending, /已停止生成/)
    await bounded(received)
    controller.abort()
    await bounded(rejected)
    await bounded(closed)
    const previous = delta
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(delta, previous, '取消后不再输出')
  }
  const controller = new AbortController()
  let retried = 0
  const before = requests
  const pending = callReportModel({ ...base, model: 'retry' }, 'test', undefined, {
    signal: controller.signal, onRetry: () => { retried++; queueMicrotask(() => controller.abort()) },
  })
  await assert.rejects(pending, /已停止生成/)
  assert.equal(retried, 1)
  assert.equal(requests - before, 1, '取消重试等待后不得再次发送请求')
  const stopped = new AbortController(); stopped.abort()
  await assert.rejects(callReportModel({ ...base, model: 'waiting' }, 'test', undefined, { signal: stopped.signal }), /已停止生成/)
  assert.equal(requests - before, 1, '已取消任务不得启动后续模型请求')
  console.log('AI 取消测试通过：等待响应和流式响应均断开 HTTP 连接、停止输出、取消重试、阻止后续请求。')
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
