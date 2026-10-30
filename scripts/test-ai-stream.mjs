import assert from 'node:assert/strict'
import { callReportModel } from '../src/main/report-model.ts'
const original = globalThis.fetch
const encoder = new TextEncoder()
try {
  for (const apiFormat of ['openai', 'anthropic']) {
    let body
    const text = '# 总结\n\n- **讨论内容**'
    const event = apiFormat === 'openai' ? { choices: [{ delta: { content: text } }] } : { type: 'content_block_delta', delta: { type: 'text_delta', text } }
    const bytes = encoder.encode(`event: message\r\ndata: ${JSON.stringify(event)}\r\n\r\ndata: [DONE]\n\n`)
    globalThis.fetch = async (_url, options) => {
      body = JSON.parse(options.body)
      return new Response(new ReadableStream({ start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 3) controller.enqueue(bytes.slice(offset, offset + 3))
        controller.close()
      } }))
    }
    let received = ''
    const result = await callReportModel({ apiFormat, apiKey: 'test', baseUrl: 'https://example.invalid', model: 'test' }, '问题', undefined, { onDelta: delta => { received += delta } })
    assert.equal(body.stream, true)
    assert.equal(received, text)
    assert.equal(result, text)
  }
  globalThis.fetch = async () => new Response('data: {"error":{"message":"failed"}}\n\n')
  await assert.rejects(() => callReportModel({ apiFormat: 'openai', apiKey: 'test', baseUrl: 'https://example.invalid', model: 'test' }, '问题', undefined, { onDelta() {} }), /流式响应失败/)
  console.log('AI stream: OpenAI, Anthropic, fragmented UTF-8 and server errors passed')
} finally { globalThis.fetch = original }
