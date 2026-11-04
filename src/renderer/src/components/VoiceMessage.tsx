import { useEffect, useRef, useState } from 'react'
import type { SyncMessage } from '../../../shared/types'
import { ActionButton } from './ui/ActionButton'
import { ChatText } from './ChatText'

export function VoiceMessage({ message, root, conversationId }: { message: SyncMessage; root?: string; conversationId: string }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const transcribe = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await window.wetrace.transcribeVoiceMessage({ root, conversationId, id: message.id, createdAt: message.createdAt })
      if (!active.current) return
      if (!result.ok) throw new Error(result.error)
      setText(result.text)
      setError(result.warning ?? '')
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '语音转写失败，请重试') }
    finally { if (active.current) setBusy(false) }
  }
  return <div className="message-voice">
    <div>语音消息 {!text && <ActionButton className="btn sm" disabled={busy} onClick={() => void transcribe()}>{busy ? '本地识别中…' : error ? '重试转文字' : '转文字'}</ActionButton>}</div>
    {text && <div><small>本地语音转写</small><div><ChatText>{text}</ChatText></div></div>}
    {error && <div role="status">{error}</div>}
  </div>
}
