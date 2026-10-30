import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { HotspotConfig } from '../shared/ai-knowledge'

export async function fetchMcpHotspots(config: HotspotConfig, signal?: AbortSignal): Promise<string> {
  const client = new Client({ name: 'WeTrace-hotspots', version: '1.0.0' }, { capabilities: {} })
  const timeout = AbortSignal.timeout(20_000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    fetch: (url, init) => fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, combined]) : combined }),
  })
  try {
    await client.connect(transport)
    const tools = await client.listTools({}, { signal: combined, timeout: 20_000 })
    if (!tools.tools.some(tool => tool.name === config.tool)) throw new Error('未找到指定工具')
    // Only static user-configured public hotspot arguments leave the app. No chat content.
    const result = await client.callTool({ name: config.tool, arguments: JSON.parse(config.argumentsJson) }, undefined, { signal: combined, timeout: 20_000 })
    if (result.isError) throw new Error('热点工具返回错误')
    const content = result.content as { type: string; text?: string }[]
    const text = content.filter(item => item.type === 'text').map(item => item.text ?? '').join('\n').slice(0, 10000)
    if (!text.trim()) throw new Error('热点工具未返回文本')
    return text
  } finally { await client.close().catch(() => undefined) }
}
