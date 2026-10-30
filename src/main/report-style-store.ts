import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { defaultReportStyles, type ReportWritingStyle, type SaveReportStyleInput } from '../shared/report-styles'

function configPath(): string { return path.join(app.getPath('userData'), 'report-styles.json') }

function normalize(input: SaveReportStyleInput): Pick<ReportWritingStyle, 'name' | 'prompt'> {
  if (!input || typeof input.name !== 'string' || typeof input.prompt !== 'string') throw new Error('风格配置无效')
  const name = input.name.trim()
  const prompt = input.prompt.trim()
  if (!name || name.length > 40) throw new Error('请填写 1–40 字的风格名称')
  if (!prompt || prompt.length > 3000) throw new Error('请填写 1–3000 字的内容风格要求')
  return { name, prompt }
}

function readCustomStyles(): ReportWritingStyle[] {
  const file = configPath()
  if (!fs.existsSync(file)) return []
  const rows: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Array.isArray(rows)) throw new Error('已保存的报告风格格式无效')
  const ids = new Set(defaultReportStyles.map(style => style.id))
  return rows.map(row => {
    if (!row || typeof row.id !== 'string' || !row.id.startsWith('custom-') || ids.has(row.id)) throw new Error('已保存的报告风格无效')
    ids.add(row.id)
    return { id: row.id, ...normalize(row), builtin: false }
  })
}

function writeCustomStyles(styles: ReportWritingStyle[]): void {
  const file = configPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(styles, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, file)
}

export function listReportStyles(): ReportWritingStyle[] { return [...defaultReportStyles, ...readCustomStyles()] }

export function resolveReportStyle(id: string): ReportWritingStyle {
  const style = listReportStyles().find(item => item.id === id)
  if (!style) throw new Error('所选报告风格已不存在，请重新选择')
  return style
}

export function saveReportStyle(input: SaveReportStyleInput): ReportWritingStyle {
  const values = normalize(input)
  const styles = readCustomStyles()
  const index = input.id ? styles.findIndex(style => style.id === input.id) : -1
  if (input.id && index < 0) throw new Error('只能编辑已保存的自定义风格')
  if ([...defaultReportStyles, ...styles].some(style => style.id !== input.id && style.name === values.name)) throw new Error('已有同名风格，请换一个名称')
  const next = { id: input.id || `custom-${randomUUID()}`, ...values, builtin: false }
  if (index >= 0) styles[index] = next
  else styles.push(next)
  writeCustomStyles(styles)
  return next
}

export function deleteReportStyle(id: string): ReportWritingStyle[] {
  const styles = readCustomStyles()
  if (!styles.some(style => style.id === id)) throw new Error('只能删除已保存的自定义风格')
  writeCustomStyles(styles.filter(style => style.id !== id))
  return listReportStyles()
}
