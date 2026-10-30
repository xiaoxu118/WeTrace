import { useEffect, useRef, useState } from 'react'
import type { ChatIndexAction, ChatIndexStatus } from '../../../shared/chat-index'

const INDEX_UPDATE_INTERVAL = 30 * 60 * 1000

export function useChatIndex(root?: string) {
  const [status, setStatus] = useState<ChatIndexStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const activeRoot = useRef(root)
  activeRoot.current = root
  async function control(action: ChatIndexAction) {
    if (!root || busy) return
    setBusy(true)
    try {
      const response = await window.wetrace.controlChatIndex({ root, action })
      if (activeRoot.current !== root) return
      if (!response.ok) throw new Error(response.error)
      setStatus(response.data); setError('')
    } catch (error) { if (activeRoot.current === root) setError(error instanceof Error ? error.message : '索引操作失败') }
    finally { if (activeRoot.current === root) setBusy(false) }
  }
  useEffect(() => {
    setStatus(null); setError(''); setBusy(false)
    if (!root || !window.wetrace.controlChatIndex) return
    let active = true
    let timer: number | undefined
    let delay = 2000
    async function poll(first = false) {
      try {
        let response = await window.wetrace.controlChatIndex({ root, action: 'status' })
        if (active && first && response.ok && response.data.state !== 'paused' && (response.data.state === 'idle' || response.data.state === 'building' || !response.data.updatedAt || Date.now() - new Date(response.data.updatedAt).getTime() >= INDEX_UPDATE_INTERVAL)) {
          response = await window.wetrace.controlChatIndex({ root, action: 'sync' })
        }
        if (!active) return
        if (response.ok) { setStatus(response.data); setError(''); delay = response.data.state === 'building' ? 2000 : 10000 }
        else setError(response.error)
      } catch (error) { if (active) setError(error instanceof Error ? error.message : '读取索引状态失败') }
      if (active) timer = window.setTimeout(() => void poll(), delay)
    }
    void poll(true)
    // Index updates are independent of the more frequent chat/status refreshes.
    const refresh = window.setInterval(() => { void window.wetrace.controlChatIndex({ root, action: 'sync' }).catch(() => undefined) }, INDEX_UPDATE_INTERVAL)
    return () => { active = false; window.clearTimeout(timer); window.clearInterval(refresh) }
  }, [root])
  return { status, error, busy, control }
}

export function ChatIndexPanel({ state }: { state: ReturnType<typeof useChatIndex> }) {
  const { status, error, busy, control } = state
  const label = status ? { idle: '等待建立', building: '正在建立', paused: '已暂停', ready: '已就绪', error: '部分记录待重试' }[status.state] : '读取中…'
  const percent = status?.totalStores ? Math.round(status.completedStores / status.totalStores * 100) : 0
  return <section className="chat-index-panel" aria-label="全部聊天记录索引">
    <div className="chat-index-title"><h3>全部聊天记录索引</h3><span>{label}</span></div>
    <p>自动发现全部聊天消息表，首次建立后保存到本机。后续每半小时自动增量补充新消息，暂停或退出后从已保存的批次继续；报告、消息计数与成员统计优先复用索引。正文加密保存。</p>
    {status?.updatedAt && <p>最近完成：{new Date(status.updatedAt).toLocaleString('zh-CN')}。每半小时补入新增记录，历史正文每天核对。</p>}
    <b>{status?.messages.toLocaleString() ?? '—'} 条消息 · {status?.conversations.toLocaleString() ?? '—'} 个会话</b>
    {status?.state === 'building' && <><div className="asr-download-track" role="progressbar" aria-label="聊天索引进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div><small>已完成 {status.completedStores}/{status.totalStores} 个消息表</small></>}
    <div className="report-style-actions"><button type="button" className="btn sm" disabled={busy} onClick={() => void control(status?.state === 'building' ? 'pause' : 'start')}>{status?.state === 'building' ? '暂停建立' : status?.state === 'paused' ? '继续建立' : '更新索引'}</button></div>
    {(error || !!status?.errors.length) && <details><summary>索引处理说明</summary><p>{error}</p>{status?.errors.map((item, index) => <p key={index}>{item}</p>)}</details>}
  </section>
}
