import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type { ModelConfig, SaveModelConfigInput } from '../shared/types'

interface StoredModelConfig extends Omit<ModelConfig, 'hasApiKey'> {
  apiKey: string
}

function configFile(): string {
  return path.join(app.getPath('userData'), 'model-configs.bin')
}

function requireEncryption(): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存模型配置')
}

function readConfigs(): StoredModelConfig[] {
  const file = configFile()
  if (!fs.existsSync(file)) return []
  requireEncryption()
  const parsed: unknown = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)))
  if (!Array.isArray(parsed)) throw new Error('已保存的模型配置格式无效')
  const configs = (parsed as StoredModelConfig[]).map(config => ({ ...config, kind: config.kind ?? 'text', source: config.source ?? 'remote', apiFormat: config.apiFormat ?? 'openai', name: config.name || config.model, localPath: config.localPath ?? '', isDefault: Boolean(config.isDefault) }))
  const defaultedKinds = new Set<StoredModelConfig['kind']>()
  return configs.map(config => {
    const hasExplicitDefault = configs.some(item => item.kind === config.kind && item.isDefault)
    const isDefault = !defaultedKinds.has(config.kind) && (config.isDefault || !hasExplicitDefault)
    if (isDefault) defaultedKinds.add(config.kind)
    return { ...config, isDefault }
  })
}

function writeConfigs(configs: StoredModelConfig[]): void {
  requireEncryption()
  const file = configFile()
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(configs)), { mode: 0o600 })
  fs.renameSync(temporary, file)
  fs.chmodSync(file, 0o600)
}

function publicConfig(config: StoredModelConfig): ModelConfig {
  return {
    id: config.id,
    kind: config.kind,
    source: config.source,
    apiFormat: config.apiFormat,
    name: config.name || config.model,
    isDefault: config.isDefault,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    localPath: config.localPath,
    hasApiKey: Boolean(config.apiKey),
  }
}

export function listModelConfigs(): ModelConfig[] {
  return readConfigs().map(publicConfig)
}

function normalizeModelConfig(input: SaveModelConfigInput) {
  const kind = input.kind ?? 'text'
  const source = input.source ?? 'remote'
  const apiFormat = input.apiFormat ?? 'openai'
  if (!['text', 'image', 'speech'].includes(kind)) throw new Error('请选择文本、图片或语音模型')
  if (!['remote', 'local'].includes(source)) throw new Error('请选择在线服务或本地模型')
  if (!['openai', 'anthropic'].includes(apiFormat)) throw new Error('请选择 OpenAI 或 Anthropic 接口格式')
  const name = input.name.trim()
  const provider = input.provider.trim()
  const baseUrl = input.baseUrl.trim()
  const model = input.model.trim()
  const localPath = input.localPath?.trim() ?? ''
  if (!name) throw new Error('请填写配置名称')
  if (!model) throw new Error('请填写模型 ID')
  if (source === 'local') {
    if (kind !== 'speech') throw new Error('本地模型目前仅用于语音转文字')
    if (!localPath) throw new Error('请选择本地模型目录')
    let directory: fs.Stats
    try {
      directory = fs.statSync(localPath)
    } catch {
      throw new Error('本地模型目录不存在，请重新选择')
    }
    if (!directory.isDirectory()) throw new Error('本地模型路径必须是目录')
    return { kind, source, apiFormat: 'openai' as const, name, provider: '本地模型', baseUrl: '', model, localPath }
  }
  if (!provider) throw new Error('请填写服务商')
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error('请输入有效的 Base URL')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Base URL 只支持 HTTP 或 HTTPS')
  return { kind, source, apiFormat, name, provider, baseUrl, model, localPath: '' }
}

export function saveModelConfig(input: SaveModelConfigInput): ModelConfig {
  const { kind, source, apiFormat, name, provider, baseUrl, model, localPath } = normalizeModelConfig(input)
  const configs = readConfigs()
  const index = input.id ? configs.findIndex((item) => item.id === input.id) : -1
  if (input.id && index < 0) throw new Error('该模型配置已不存在，请刷新列表')
  const previous = index >= 0 ? configs[index] : null
  if (source === 'remote' && !previous && !input.apiKey?.trim()) throw new Error('请填写 API Key')
  const next: StoredModelConfig = {
    id: previous?.id ?? randomUUID(),
    kind,
    source,
    apiFormat,
    name,
    isDefault: previous?.isDefault ?? !configs.some(item => item.kind === kind),
    provider,
    baseUrl,
    model,
    localPath,
    apiKey: source === 'local' ? '' : input.apiKey?.trim() || (previous?.provider === provider ? previous.apiKey : ''),
  }
  if (index >= 0) configs[index] = next
  else configs.push(next)
  writeConfigs(configs)
  return publicConfig(next)
}

export function deleteModelConfig(id: string): ModelConfig[] {
  const configs = readConfigs()
  const removed = configs.find(item => item.id === id)
  if (!removed) throw new Error('该模型配置已不存在')
  const remaining = configs.filter(item => item.id !== id)
  if (removed.isDefault) {
    const fallback = remaining.find(item => item.kind === removed.kind)
    if (fallback) fallback.isDefault = true
  }
  writeConfigs(remaining)
  return remaining.map(publicConfig)
}

export function setDefaultModelConfig(id: string): ModelConfig[] {
  const configs = readConfigs()
  const selected = configs.find(config => config.id === id)
  if (!selected) throw new Error('该模型配置已不存在')
  const next = configs.map(config => config.kind === selected.kind ? { ...config, isDefault: config.id === id } : config)
  writeConfigs(next)
  return next.map(publicConfig)
}

function modelErrorDetail(body: string): string {
  const normalized = body.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  try {
    const parsed = JSON.parse(normalized) as { error?: unknown; message?: unknown }
    if (typeof parsed.error === 'string') return parsed.error.slice(0, 200)
    if (typeof parsed.message === 'string') return parsed.message.slice(0, 200)
    if (parsed.error && typeof parsed.error === 'object' && 'message' in parsed.error && typeof parsed.error.message === 'string') {
      return parsed.error.message.slice(0, 200)
    }
  } catch {
    // 非 JSON 错误响应直接展示摘要。
  }
  return normalized.slice(0, 200)
}

export async function testModelConfig(input: SaveModelConfigInput): Promise<{ latencyMs: number }> {
  const startedAt = Date.now()
  const { source, apiFormat, provider, baseUrl, model } = normalizeModelConfig(input)
  if (source === 'local') return { latencyMs: Date.now() - startedAt }
  const configs = readConfigs()
  const previous = input.id ? configs.find((item) => item.id === input.id) : undefined
  if (input.id && !previous) throw new Error('该模型配置已不存在，请刷新列表')
  const apiKey = input.apiKey?.trim() || (previous?.provider === provider ? previous.apiKey : '')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let url: string
  let body: string
  if (apiFormat === 'anthropic') {
    url = `${baseUrl.replace(/\/+$/, '')}/messages`
    if (apiKey) headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
    body = JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: '请回复 OK。' }] })
  } else {
    url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    body = JSON.stringify({ model, max_tokens: 8, stream: false, messages: [{ role: 'user', content: '请回复 OK。' }] })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal })
    const responseBody = await response.text()
    if (!response.ok) {
      const detail = modelErrorDetail(responseBody)
      throw new Error(`模型服务返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`)
    }
    return { latencyMs: Date.now() - startedAt }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('模型测试超时（15 秒），请检查 Base URL 和网络连接')
    if (error instanceof Error && error.message.startsWith('模型服务返回 HTTP')) throw error
    throw new Error(`模型连接失败：${error instanceof Error ? error.message : '未知网络错误'}`)
  } finally {
    clearTimeout(timeout)
  }
}

// Credentials stay in the main process.
export function resolveReportModel(id: string, kind: 'text' | 'image'): StoredModelConfig {
  const config = readConfigs().find(item => item.id === id && item.kind === kind && item.source === 'remote')
  if (!config) throw new Error(kind === 'image' ? '请配置图片理解模型' : '请配置基础语言模型')
  return config
}
