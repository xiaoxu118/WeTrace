import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createReportDiagnostics, reportFailureAdvice } from '../src/main/report-diagnostics.ts'
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wetrace-diagnostics-'))
try {
  const log = createReportDiagnostics(directory, { requestId: '../../task', startDate: '2026-10-26', endDate: '2026-10-27', conversationName: 'PRIVATE_GROUP', apiKey: 'SECRET', messages: ['PRIVATE_CHAT'] })
  log.append({ event: 'failure', stage: 'summarize', error: '模型输出达到长度限制' })
  const text = fs.readFileSync(log.path, 'utf8')
  assert.equal(path.dirname(log.path), directory)
  assert.ok(!/SECRET|PRIVATE_GROUP|PRIVATE_CHAT/.test(text))
  assert.equal(text.trim().split('\n').length, 2)
  assert.equal(fs.statSync(log.path).mode & 0o777, 0o600)
  assert.match(reportFailureAdvice('模型输出达到长度限制'), /简洁风格/)
  assert.match(reportFailureAdvice('HTTP 429'), /额度/)
  assert.match(reportFailureAdvice('模型请求超时'), /网络/)
  const file = path.join(directory, 'file'); fs.writeFileSync(file, '')
  const unavailable = createReportDiagnostics(path.join(file, 'reports'), { requestId: 'task' })
  unavailable.append({ event: 'failure' })
  assert.equal(unavailable.path, undefined)
  console.log('报告诊断测试通过：任务阶段日志、敏感数据排除、权限、日志不可用时不阻断生成、分类排查建议。')
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
