import fs from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { defaultAiKnowledge, type AiKnowledge, type HotspotResult } from '../shared/ai-knowledge'
import { fetchMcpHotspots } from './hotspot-mcp'
const file = () => join(app.getPath('userData'), 'ai-knowledge.json')
export function loadAiKnowledge(): AiKnowledge {
  if (!fs.existsSync(file())) return structuredClone(defaultAiKnowledge)
  return validateKnowledge(JSON.parse(fs.readFileSync(file(), 'utf8')))
}
export function validateKnowledge(input: AiKnowledge): AiKnowledge {
  if (!input || !Array.isArray(input.memes) || input.memes.length > 200) throw new Error('热梗库最多保存200条')
  const memes = input.memes.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.phrase !== 'string' || !item.phrase.trim() || item.phrase.length > 100 || typeof item.meaning !== 'string' || item.meaning.length > 600 || typeof item.example !== 'string' || item.example.length > 600 || !Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== 'string' || tag.length > 40) || item.tags.length > 20) throw new Error('热梗格式无效或内容过长')
    return { id: item.id, phrase: item.phrase.trim(), meaning: item.meaning, example: item.example, tags: item.tags }
  })
  if (new Set(memes.map(item => item.id)).size !== memes.length) throw new Error('热梗编号重复')
  const config = input.hotspot
  if (!config || typeof config.enabled !== 'boolean' || typeof config.url !== 'string' || typeof config.tool !== 'string' || !config.tool.trim() || config.tool.length > 120 || typeof config.argumentsJson !== 'string' || config.argumentsJson.length > 4000) throw new Error('热点来源配置无效')
  const url = config.url.trim() ? new URL(config.url.trim()) : null
  if (config.enabled && !url) throw new Error('启用热点前请填写服务地址')
  if (url && (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))))) throw new Error('请使用 HTTPS 地址，本地服务可使用 HTTP；地址不能包含账号密码')
  const args = JSON.parse(config.argumentsJson)
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是 JSON 对象')
  return { memes, hotspot: { ...config, url: url?.toString() ?? '', tool: config.tool.trim() } }
}
export function saveAiKnowledge(input: AiKnowledge): AiKnowledge {
  const value = validateKnowledge(input)
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(`${file()}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 })
  fs.renameSync(`${file()}.tmp`, file())
  return value
}
export async function getHotspots(force = false, signal?: AbortSignal): Promise<HotspotResult> {
  const { hotspot } = loadAiKnowledge()
  if (!hotspot.url || (!hotspot.enabled && !force)) return { text: '', fetchedAt: '', cached: false }
  const cacheFile = join(app.getPath('userData'), 'ai-hotspots.json')
  const key = JSON.stringify(hotspot)
  let cache: { key: string; text: string; fetchedAt: string } | undefined
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) } catch { /* first fetch */ }
  if (!force && cache?.key === key && Date.now() - Date.parse(cache.fetchedAt) < 15 * 60_000) return { ...cache, cached: true }
  try {
    const text = await fetchMcpHotspots(hotspot, signal)
    const result = { text, fetchedAt: new Date().toISOString(), cached: false }
    fs.writeFileSync(cacheFile, JSON.stringify({ ...result, key }), { mode: 0o600 })
    return result
  } catch {
    signal?.throwIfAborted()
    if (cache?.key === key && Date.now() - Date.parse(cache.fetchedAt) < 24 * 3600_000) return { text: cache.text, fetchedAt: cache.fetchedAt, cached: true, error: '实时获取失败，使用24小时内缓存' }
    return { text: '', fetchedAt: '', cached: false, error: 'MCP 热点获取失败，请检查服务地址、工具名称和参数；将继续使用本地热梗库' }
  }
}
