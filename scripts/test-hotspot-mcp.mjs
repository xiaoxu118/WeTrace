import assert from 'node:assert/strict'
import http from 'node:http'
import { fetchMcpHotspots } from '../src/main/hotspot-mcp.ts'
const calls = []
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(405).end(); return }
  let body = ''
  for await (const chunk of req) body += chunk
  const message = JSON.parse(body)
  calls.push(message)
  if (message.id === undefined) { res.writeHead(202).end(); return }
  let result
  if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'test', version: '1' } }
  if (message.method === 'tools/list') result = { tools: [{ name: 'hot', inputSchema: { type: 'object', properties: {} } }] }
  if (message.method === 'tools/call') result = { content: [{ type: 'text', text: '今日公共热点：测试话题' }] }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const config = { enabled: true, url: `http://127.0.0.1:${server.address().port}/mcp`, tool: 'hot', argumentsJson: '{"platform":"douyin","limit":5}' }
try {
  assert.match(await fetchMcpHotspots(config), /公共热点/)
  assert.deepEqual(calls.find(item => item.method === 'tools/call').params, { name: 'hot', arguments: { platform: 'douyin', limit: 5 } })
  await assert.rejects(() => fetchMcpHotspots({ ...config, tool: 'missing' }), /未找到/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(() => fetchMcpHotspots(config, controller.signal))
  console.log('MCP: handshake, tool discovery, fixed public arguments, response, unknown tool and cancellation passed')
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
