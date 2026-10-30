import { AiPromptEditor } from './AiPromptEditor'
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export function AiKnowledgePanel({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => previous?.focus()
  }, [])
  return <div className="ai-knowledge-overlay" onKeyDown={event => { if (event.key === 'Escape') onClose(); if (event.key === 'Tab') { const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary') ?? []).filter(element => element.getClientRects().length > 0); const first = controls[0], last = controls[controls.length - 1]; if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() } } }}><section ref={panel} tabIndex={-1} className="ai-knowledge-panel" role="dialog" aria-modal="true" aria-label="AI 对话设置">
    <header><div><h2>AI 对话设置</h2><p>调整对话风格与提示词。</p></div><button className="btn sm" aria-label="关闭对话设置" onClick={onClose}><X size={16} /></button></header>
    <div className="ai-knowledge-body">
      <AiPromptEditor />
    </div>
  </section></div>
}
