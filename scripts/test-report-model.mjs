import assert from 'node:assert/strict'
import http from 'node:http'
import { callReportModel, splitReportText, escapeReportHtml } from '../src/main/report-model.ts'

const requests = []
const server = http.createServer(async (request, response) => {
  let text = ''
  for await (const chunk of request) text += chunk
  const body = JSON.parse(text)
  requests.push({ url: request.url, headers: request.headers, body })
  response.setHeader('Content-Type', 'application/json')
  if (body.model === 'error') { response.writeHead(401); response.end('{}'); return }
  if (body.model === 'quota') { response.writeHead(429); response.end(JSON.stringify({error: {code: 'quota_exceeded', message: 'PRIVATE_RESPONSE_MUST_NOT_LEAK'}})); return }
  if (body.model === 'invalid-json') { response.end('<html>bad gateway</html>'); return }
  if (body.model === 'empty') { response.end('{}'); return }
  if (body.model === 'continued') {
    const previous = body.messages.find(message => message.role === 'assistant')
    const part = previous ? '第二部分"},"topics":[]}' : '{"hero":{"summary":"第一部分 '
    response.end(JSON.stringify(request.url === '/v1/messages'
      ? { stop_reason: previous ? 'end_turn' : 'max_tokens', content: [{ type: 'text', text: part }] }
      : { choices: [{ finish_reason: previous ? 'stop' : 'length', message: { content: part } }] }))
    return
  }
  if (body.model === 'truncated') { response.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] })); return }
  response.end(JSON.stringify(request.url === '/v1/messages' ? { content: [{ type: 'text', text: '报告内容' }] } : { choices: [{ message: { content: '报告内容' } }] }))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  const config = { apiFormat: 'openai', baseUrl: `http://127.0.0.1:${server.address().port}/v1/`, model: 'test', apiKey: 'test-key' }
  assert.equal(await callReportModel(config, '测试'), '报告内容')
  assert.equal(requests.at(-1).url, '/v1/chat/completions')
  assert.equal(requests.at(-1).headers.authorization, 'Bearer test-key')
  const image = { mime: 'image/png', data: Buffer.from('image') }
  await callReportModel(config, '图片', image)
  assert.match(requests.at(-1).body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/)
  await callReportModel({ ...config, apiFormat: 'anthropic' }, '图片', image)
  assert.equal(requests.at(-1).url, '/v1/messages')
  assert.equal(requests.at(-1).headers['x-api-key'], 'test-key')
  assert.equal(requests.at(-1).body.messages[0].content[0].source.media_type, 'image/png')
  await assert.rejects(callReportModel({ ...config, model: 'error' }, '测试'), /HTTP 401/)
  await assert.rejects(callReportModel({ ...config, model: 'empty' }, '测试'), /有效文本/)
  await assert.rejects(callReportModel({ ...config, model: 'truncated' }, '测试'), /长度限制/)
  await assert.rejects(callReportModel({ ...config, model: 'quota' }, '测试'), error => /HTTP 429.*quota_exceeded/.test(error.message) && !error.message.includes('PRIVATE_RESPONSE'))
  await assert.rejects(callReportModel({ ...config, model: 'invalid-json' }, '测试'), /无效 JSON/)
  await callReportModel(config, '提高预算', undefined, { maxTokens: 8192 })
  assert.equal(requests.at(-1).body.max_tokens, 8192)
  const continuations = []
  const continued = await callReportModel({ ...config, model: 'continued' }, '完整报告', undefined, { continueOnLength: true, onContinuation: (part, characters) => continuations.push({part, characters}) })
  assert.equal(JSON.parse(continued).hero.summary, '第一部分 第二部分')
  assert.equal(continuations.length, 1)
  assert.equal(requests.at(-1).body.messages[1].role, 'assistant')
  const anthropicContinued = await callReportModel({ ...config, apiFormat: 'anthropic', model: 'continued' }, '完整报告', undefined, { continueOnLength: true })
  assert.deepEqual(JSON.parse(anthropicContinued), JSON.parse(continued))
  const beforeLimit = requests.length
  await assert.rejects(callReportModel({ ...config, model: 'truncated' }, '始终截断', undefined, { continueOnLength: true }), /长度限制/)
  assert.equal(requests.length - beforeLimit, 4, '最多三次接续，不无限请求或把截断内容当成功')
  const input = ['a'.repeat(45000), 'b'.repeat(1000)]
  const chunks = splitReportText(input)
  assert.ok(chunks.every(chunk => chunk.length > 0 && chunk.length <= 18001))
  assert.equal(chunks.join('').replaceAll('\n', ''), input.join(''))
  assert.equal(escapeReportHtml('<script>"&'), '&lt;script&gt;&quot;&amp;')
  console.log('报告模型自测通过：两种接口、图片请求、错误响应、截断检测、完整分段与 HTML 转义。')
} finally { server.close() }
