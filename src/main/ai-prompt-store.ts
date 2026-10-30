import fs from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { chatQueryPrompt, chatAnswerPrompt } from './ai-chat-prompts'
import type { AiPromptSettings, AiPromptSettingsResponse, SaveAiPromptsInput } from '../shared/ai-prompt-settings'
export const defaultStylePrompt = '用自然、清晰、有重点的中文回答，像熟悉上下文的同事。先给结论，再按需要展开；避免套话和空泛标签。用简洁的 Markdown 排版，不堆砌标题、表格或加粗。根据用户语气调整轻松程度，严肃问题保持克制。'
export function defaultAiPrompts(): AiPromptSettings {
  return { query: chatQueryPrompt('{{today}}', '{{timezone}}'), answer: chatAnswerPrompt }
}
const file = () => join(app.getPath('userData'), 'ai-prompts.json')
export function validateAiPrompts(input: SaveAiPromptsInput): SaveAiPromptsInput {
  if (!input || !Array.isArray(input.styles) || input.styles.length < 1 || input.styles.length > 30) throw new Error('风格数量须为1至30个')
  const styles = input.styles.map(style => {
    if (!style || typeof style.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(style.id) || typeof style.name !== 'string' || !style.name.trim() || style.name.trim().length > 40 || typeof style.prompt !== 'string' || !style.prompt.trim() || style.prompt.length > 12000) throw new Error('请填写风格名称（最多40字）和提示词（最多12000字符）')
    return { id: style.id, name: style.id === 'default' ? '默认风格' : style.name.trim(), prompt: style.id === 'default' ? defaultStylePrompt : style.prompt }
  })
  if (new Set(styles.map(style => style.id)).size !== styles.length) throw new Error('风格编号重复')
  if (new Set(styles.map(style => style.name)).size !== styles.length) throw new Error('风格名称不能重复')
  if (!styles.some(style => style.id === 'default')) throw new Error('默认风格不能删除')
  if (!styles.some(style => style.id === input.selectedStyleId)) throw new Error('请选择有效的风格')
  return { selectedStyleId: input.selectedStyleId, styles }
}
function response(settings: SaveAiPromptsInput): AiPromptSettingsResponse {
  const defaults = defaultAiPrompts()
  return { ...settings, current: { ...defaults }, defaults, defaultStylePrompt }
}
export function loadAiPrompts(): AiPromptSettingsResponse {
  if (fs.existsSync(file())) {
    const stored = JSON.parse(fs.readFileSync(file(), 'utf8'))
    if (stored.schemaVersion === 3) return response(validateAiPrompts(stored))
  }
  // Earlier full task prompts are not treated as presentation styles.
  return response({ selectedStyleId: 'default', styles: [{ id: 'default', name: '默认风格', prompt: defaultStylePrompt }] })
}
export function saveAiPrompts(input: SaveAiPromptsInput): AiPromptSettingsResponse {
  const value = validateAiPrompts(input)
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  if (fs.existsSync(file())) {
    const stored = JSON.parse(fs.readFileSync(file(), 'utf8'))
    if (stored.schemaVersion !== 3 && !fs.existsSync(`${file()}.legacy.json`)) fs.copyFileSync(file(), `${file()}.legacy.json`, fs.constants.COPYFILE_EXCL)
  }
  fs.writeFileSync(`${file()}.tmp`, JSON.stringify({ ...value, schemaVersion: 3 }, null, 2), { mode: 0o600 })
  fs.renameSync(`${file()}.tmp`, file())
  return response(value)
}
export function renderQueryPrompt(template: string, today: string, timezone: string): string {
  return template.replaceAll('{{today}}', today).replaceAll('{{timezone}}', timezone)
}
