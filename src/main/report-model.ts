import type { ModelConfig } from '../shared/types'

interface ReportModelOptions { onRetry?: (attempt: number, delayMs: number) => void; maxTokens?: number; onDelta?: (text: string) => void; signal?: AbortSignal; continueOnLength?: boolean; onContinuation?: (part: number, characters: number) => void }
class ReportOutputLimitError extends Error {
  readonly partialText: string
  constructor(partialText: string) {
    super('模型输出达到长度限制，请缩小日期范围或选择简洁风格后重试')
    this.partialText = partialText
  }
}
export class ModelContextLimitError extends Error {
  constructor() { super('模型上下文容量不足，正在尝试缩小分析批次') }
}
class ModelHttpError extends Error {
  status: number
  retryAfterMs?: number
  constructor(message: string, status: number, retryAfter: string | null) {
    super(message)
    this.status = status
    if (retryAfter !== null) {
      const seconds = Number(retryAfter)
      const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now()
      if (Number.isFinite(delay)) this.retryAfterMs = Math.max(0, Math.min(10000, delay))
    }
  }
}
async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const timer = setTimeout(() => { cleanup(); resolve() }, delayMs)
    const abort = () => { clearTimeout(timer); cleanup(); reject(signal?.reason ?? new Error('已停止生成')) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}
async function requestWithRetry(config: Config, prompt: string, image: { data: Buffer; mime: string } | undefined, options: ReportModelOptions, previous: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted()
    try { return await requestReportModel(config, prompt, image, options, previous) }
    catch (error) {
      // Only retry a rejected HTTP request. Never replay a partially emitted stream.
      if (!(error instanceof ModelHttpError) || ![502, 503, 504].includes(error.status) || attempt >= 2 || options.signal?.aborted) throw error
      const delay = error.retryAfterMs ?? (attempt === 0 ? 1000 : 3000)
      options.onRetry?.(attempt + 1, delay)
      await waitForRetry(delay, options.signal)
    }
  }
}
type Config = Omit<ModelConfig, 'hasApiKey'> & { apiKey: string }
async function requestReportModel(config: Config, prompt: string, image?: { data: Buffer; mime: string }, options: ReportModelOptions = {}, previous = ''): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const anthropic = config.apiFormat === 'anthropic'
  if (anthropic) {
    headers['x-api-key'] = config.apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else headers.Authorization = `Bearer ${config.apiKey}`
  const content = image ? anthropic
    ? [{ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data.toString('base64') } }, { type: 'text', text: prompt }]
    : [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data.toString('base64')}` } }]
    : prompt
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/${anthropic ? 'messages' : 'chat/completions'}`, {
    method: 'POST', headers, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
    body: JSON.stringify({ model: config.model, max_tokens: options.maxTokens ?? 4096, stream: Boolean(options.onDelta), messages: [{ role: 'user', content }, ...(previous ? [{ role: 'assistant', content: previous }, { role: 'user', content: '上一条回答因输出长度限制被截断。请从最后一个字符后继续，只输出剩余内容，不重复已输出内容，不加开场白、代码围栏或新的根对象。若截断在JSON字符串或字段中，直接补全该处并继续，最终闭合原来的JSON结构。' }] : [])] }),
  })
  if (!response.ok) {
    const reasons: Record<number, string> = {
      400: '请求参数不被模型服务接受，请检查模型名称、接口格式或上下文长度',
      401: 'API 密钥无效或已过期', 402: '模型服务余额或额度不足',
      403: '模型调用被拒绝，请检查账号权限或服务内容限制',
      404: '模型或接口地址不存在，请检查模型名称和接口地址',
      413: '请求内容过长，请缩小日期范围',
      429: '模型服务限流或额度不足，请检查套餐后稍后重试',
    }
    let code = ''
    let contextLimit = response.status === 413
    try {
      const body = await response.json() as { error?: { code?: unknown; type?: unknown; message?: unknown } }
      const value = body.error?.code ?? body.error?.type
      // Inspect provider details only to classify capacity errors; never return their text.
      const detail = [body.error?.code, body.error?.type, body.error?.message].filter(item => typeof item === 'string').join(' ')
      if ([400, 422].includes(response.status) && /context[_ ](?:length[_ ]exceeded|window[_ ]exceeded)|maximum context length|context (?:window|length).*(?:exceed|limit|long)|(?:input|prompt|request).*(?:too (?:long|large)|exceeds?.*(?:token|context))|too many (?:input )?tokens|上下文.*(?:超|长)|输入.*(?:超.*限制|过长)/i.test(detail)) contextLimit = true
      if (typeof value === 'string' && /^[a-z\d_.-]{1,80}$/i.test(value) && !value.includes(config.apiKey)) code = `，服务错误码：${value}`
    } catch { /* HTML and unstructured server errors are not recorded. */ }
    if (contextLimit) throw new ModelContextLimitError()
    throw new ModelHttpError(`模型请求失败（HTTP ${response.status}${code}）：${reasons[response.status] || (response.status >= 500 ? '模型服务暂时异常，请稍后重试或切换模型' : '请检查模型配置或服务状态')}`, response.status, response.headers.get('retry-after'))
  }
  if (options.onDelta) {
    if (!response.body) throw new Error('模型服务未返回流式内容')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = '', output = ''
    function consume(line: string) {
      if (!line.startsWith('data:')) return
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') return
      const event = JSON.parse(data)
      if (event.error || event.type === 'error') throw new Error('模型流式响应失败，请稍后重试')
      const reason = event.choices?.[0]?.finish_reason ?? event.delta?.stop_reason
      if (reason === 'length' || reason === 'max_tokens') throw new Error('回答达到长度上限，请缩小查询范围')
      if (reason === 'content_filter') throw new Error('模型服务因内容限制中止生成')
      const delta = anthropic ? (event.type === 'content_block_delta' ? event.delta?.text : '') : event.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta) { output += delta; options.onDelta!(delta) }
    }
    try {
      while (true) {
        const { done, value } = await reader.read()
        pending += decoder.decode(value, { stream: !done })
        const lines = pending.split(/\r?\n/)
        pending = lines.pop() ?? ''
        for (const line of lines) consume(line)
        if (done) { if (pending.trim()) consume(pending); break }
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
    if (!output.trim()) throw new Error('模型未返回有效文本')
    return output.trim()
  }
  const body = await response.json() as { choices?: { finish_reason?: string; message?: { content?: string } }[]; stop_reason?: string; content?: { type: string; text?: string }[] }
  if (body.choices?.[0]?.finish_reason === 'content_filter') throw new Error('模型服务因内容限制中止生成，请调整内容范围或检查服务限制')
  const text = anthropic ? body.content?.filter(item => item.type === 'text').map(item => item.text ?? '').join('\n') : body.choices?.[0]?.message?.content
  if (body.stop_reason === 'max_tokens' || body.choices?.[0]?.finish_reason === 'length') throw new ReportOutputLimitError(typeof text === 'string' ? text : '')
  if (typeof text !== 'string' || !text.trim()) throw new Error('模型未返回有效文本，请检查模型接口格式')
  return previous ? text : text.trim()
}

export async function callReportModel(config: Config, prompt: string, image?: { data: Buffer; mime: string }, options: ReportModelOptions = {}): Promise<string> {
  try {
    let previous = ''
    for (let part = 0; ; part++) {
      try { return previous + await requestWithRetry(config, prompt, image, options, previous) }
      catch (error) {
        if (!options.continueOnLength || options.onDelta || !(error instanceof ReportOutputLimitError) || !error.partialText.trim() || part >= 3) throw error
        previous += error.partialText
        options.onContinuation?.(part + 1, previous.length)
      }
    }
  }
  catch (error) {
    if (options.signal?.aborted) throw new Error('已停止生成')
    if (error instanceof Error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('模型请求超时（超过180秒），请检查网络和模型服务，或缩小日期范围后重试')
      if (error instanceof SyntaxError) throw new Error('模型服务返回了无效 JSON，请检查接口地址与接口格式')
      if (error instanceof TypeError) throw new Error('模型网络请求失败，请检查接口地址、网络或代理连接')
    }
    throw error
  }
}

export function splitReportText(lines: string[], maxLength = 18000): string[] {
  const chunks: string[] = []
  let current = ''
  for (const line of lines) {
    for (let offset = 0; offset < line.length; offset += maxLength) {
      const piece = line.slice(offset, offset + maxLength)
      if (current && current.length + piece.length + 1 > maxLength) { chunks.push(current); current = '' }
      current += `${piece}\n`
    }
  }
  if (current) chunks.push(current)
  return chunks
}

export function escapeReportHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}
