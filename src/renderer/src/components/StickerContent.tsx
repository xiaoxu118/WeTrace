import { useEffect, useState } from 'react'
import type { SyncMessage } from '../../../shared/types'
import { SafeText } from './SafeText'

export function StickerContent({ sticker, root }: { sticker: NonNullable<SyncMessage['sticker']>; root?: string }) {
  const [source, setSource] = useState<string>(), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const [localFailed, setLocalFailed] = useState(false), [retry, setRetry] = useState(0)
  const canResolve = Boolean(root && (sticker.md5 || sticker.cdnUrl) && typeof window.wetrace.resolveSticker === 'function')
  useEffect(() => {
    if (sticker.source && !localFailed || !canResolve) return
    let active = true
    setLoading(true); setError(''); setSource(undefined)
    void window.wetrace.resolveSticker({ root, md5: sticker.md5, cdnUrl: sticker.cdnUrl }).then(result => {
      if (!active) return
      if (result.ok) setSource(result.source)
      else setError(result.error)
    }).catch(() => { if (active) setError('表情包加载失败，请重试') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [root, sticker.md5, sticker.cdnUrl, sticker.source, localFailed, retry, canResolve])
  const image = sticker.source && !localFailed ? sticker.source : source
  if (image) return <img className="message-sticker" src={image} alt={sticker.label} loading="lazy" onError={() => {
    if (image === sticker.source) setLocalFailed(true)
    else { setSource(undefined); setError('表情包图片无法显示，请重试') }
  }} />
  return <span className="message-unavailable"><SafeText>{sticker.label || '表情包'}</SafeText><small className="sticker-unavailable" role="status">{loading ? '正在加载表情包…' : error || sticker.unavailable || '表情包不可用'}</small>{canResolve && !loading && <button type="button" className="sticker-retry" onClick={() => setRetry(value => value + 1)}>重新加载</button>}</span>
}
