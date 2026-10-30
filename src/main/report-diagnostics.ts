import fs from 'node:fs'
import path from 'node:path'
import type { GenerateReportInput, ReportProgress } from '../shared/types'

export function reportFailureAdvice(detail: string): string {
  if (/401|403|密钥|认证/.test(detail)) return '在设置中检查该模型的密钥、模型名称及调用权限，并使用连接测试。'
  if (/429|额度|余额|限流/.test(detail)) return '检查模型服务余额、套餐额度或请求频率，稍后重试。'
  if (/长度限制|摘要过长|context|token|上下文/i.test(detail)) return '缩小日期范围或选择简洁风格；也可更换支持更长输出的模型。'
  if (/超时|Timeout|网络|fetch failed|ECONN|ENOTFOUND/i.test(detail)) return '检查网络和模型服务连接；可先选择一天的消息重试。语音缓存会保留。'
  if (/图片|图像/.test(detail)) return '检查图片理解模型配置；可取消图片选项后重试。'
  if (/索引|快照|会话|消息/.test(detail)) return '重新选择会话以刷新记录，再确认日期范围和内容选项。'
  if (/ENOSPC|EACCES|EPERM|保存|渲染/.test(detail)) return '检查文稿目录的可用空间和写入权限；如已生成 HTML，可先查看保存的文件。'
  return '先测试所选模型连接，再缩小日期范围重试；如仍失败，可打开诊断日志查看失败阶段与详细原因。'
}

// Never record prompts, message bodies, model responses or API keys.
export function createReportDiagnostics(directory: string, input: GenerateReportInput) {
  const filename = path.join(directory, `${Date.now()}-${input.requestId.replace(/[^a-z\d-]/gi, '').slice(0, 40)}.jsonl`)
  let available = false
  try { fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); available = true } catch { /* Logging must not prevent generation. */ }
  const append = (value: object) => {
    if (!available) return
    try { fs.appendFileSync(filename, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n', { mode: 0o600 }) } catch { available = false }
  }
  append({ event: 'start', generatorVersion: 'continuation-v1', requestId: input.requestId, startDate: input.startDate, endDate: input.endDate, modelId: input.modelId, imageModelId: input.imageModelId, contentTypes: input.contentTypes, templateId: input.templateId, style: input.style, format: input.format })
  return { append, get path() { return available ? filename : undefined } }
}
