import { ActionButton } from './ui/ActionButton'
import { Input, Select } from 'antd'
import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { AiPromptSettingsResponse, SaveAiPromptsInput } from '../../../shared/ai-prompt-settings'

export function AiPromptEditor() {
  const [loaded, setLoaded] = useState<AiPromptSettingsResponse | null>(null)
  const [draft, setDraft] = useState<SaveAiPromptsInput | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let active = true
    void window.wetrace.loadAiPrompts().then(value => { if (active) { setLoaded(value); setDraft({ selectedStyleId: value.selectedStyleId, styles: value.styles }) } }).catch(() => { if (active) setError('读取风格失败，请关闭设置后重试') })
    return () => { active = false }
  }, [])
  async function save() {
    if (!draft || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const value = await window.wetrace.saveAiPrompts(draft)
      setLoaded(value); setDraft({ selectedStyleId: value.selectedStyleId, styles: value.styles }); setNotice('风格已保存，下一次提问生效。')
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败') }
    finally { setBusy(false) }
  }
  const style = draft?.styles.find(item => item.id === draft.selectedStyleId)
  const dirty = loaded && draft && JSON.stringify(draft) !== JSON.stringify({ selectedStyleId: loaded.selectedStyleId, styles: loaded.styles })
  function edit(patch: { name?: string; prompt?: string }) {
    if (!draft || !style || style.id === 'default') return
    setDraft({ ...draft, styles: draft.styles.map(item => item.id === style.id ? { ...item, ...patch } : item) }); setNotice('')
  }
  return <div className="ai-prompt-editor">
    {draft && loaded && style && <>
      <label className="ai-style-select">对话风格<Select className="inp" aria-label="对话风格" disabled={busy} value={draft.selectedStyleId} onChange={value => setDraft({ ...draft, selectedStyleId: value })} options={draft.styles.map(item => ({ value: item.id, label: `${item.name}${item.id === loaded.selectedStyleId ? ' · 当前使用' : ''}` }))} /></label>
      <div className="ai-prompt-tabs"><ActionButton className="btn sm" disabled={busy || draft.styles.length >= 30} onClick={() => {
        let index = 1
        while (draft.styles.some(item => item.name === `自定义风格 ${index}`)) index++
        const id = crypto.randomUUID()
        setDraft({ selectedStyleId: id, styles: [...draft.styles, { id, name: `自定义风格 ${index}`, prompt: loaded.defaultStylePrompt }] })
      }}><Plus size={14} />添加风格</ActionButton>{style.id !== 'default' && <ActionButton className="btn sm" disabled={busy} onClick={() => setDraft({ selectedStyleId: 'default', styles: draft.styles.filter(item => item.id !== style.id) })}><Trash2 size={14} />删除此风格</ActionButton>}</div>
      <label>风格名称<Input className="inp" aria-label="风格名称" maxLength={40} disabled={busy || style.id === 'default'} value={style.name} onChange={event => edit({ name: event.target.value })} /></label>
      <label>风格提示词<Input.TextArea className="ai-prompt-textarea" aria-label="风格提示词" spellCheck={false} maxLength={12000} readOnly={style.id === 'default'} disabled={busy} value={style.prompt} onChange={event => edit({ prompt: event.target.value })} /></label>
      <div className="ai-prompt-actions"><span>{style.prompt.length}/12000{dirty ? ' · 尚未保存' : ''}</span>{style.id !== 'default' && <ActionButton className="btn sm" disabled={busy} onClick={() => edit({ prompt: loaded.defaultStylePrompt })}>恢复默认表达</ActionButton>}<ActionButton className="btn primary" disabled={busy || !dirty || !style.prompt.trim() || !style.name.trim()} onClick={() => void save()}>{busy ? '保存中…' : '保存并使用'}</ActionButton></div>
      <details className="ai-system-rules"><summary>查看系统任务规则（只读）</summary><p>这些规则统一负责群聊总结、人物分析和查询协议，独立于风格配置。</p><h4>查询理解规则</h4><pre>{loaded.current.query}</pre><h4>分析与回答规则</h4><pre>{loaded.current.answer}</pre></details>
    </>}
    {error && <p className="ai-error" role="alert">{error}</p>}
    {notice && <p role="status" className="ai-knowledge-status">{notice}</p>}
  </div>
}
