import type { ApiFormat, ModelKind } from './types'

export const modelKindLabels: Record<ModelKind, string> = { text: '文本', image: '图片', speech: '语音' }
export const modelProviders = ['DeepSeek', '通义千问', 'Ollama（本地）', '自定义'] as const

export function modelPreset(provider = 'DeepSeek', format: ApiFormat = 'openai', kind: ModelKind = 'text'): { baseUrl: string; model: string } {
  if (provider === 'DeepSeek') return { baseUrl: format === 'anthropic' ? 'https://api.deepseek.com/anthropic' : 'https://api.deepseek.com', model: kind === 'text' ? 'deepseek-chat' : '' }
  if (provider === '通义千问') return { baseUrl: format === 'openai' ? 'https://dashscope.aliyuncs.com/compatible-mode/v1' : '', model: kind === 'text' ? 'qwen-plus' : '' }
  if (provider === 'Ollama（本地）') return { baseUrl: format === 'openai' ? 'http://localhost:11434/v1' : '', model: '' }
  return { baseUrl: '', model: '' }
}
