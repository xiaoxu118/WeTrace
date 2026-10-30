import { useEffect, useState } from 'react'
import type { ChatIndexSearchMatch } from '../../../shared/chat-index'
import { SafeText } from './SafeText'

export function IndexedSearchResults({ root, keyword, onOpen }: { root?: string; keyword: string; onOpen: (match: ChatIndexSearchMatch) => Promise<void> }) {
  const [matches, setMatches] = useState<ChatIndexSearchMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setMatches([])
    const timer = window.setTimeout(() => {
      void window.wetrace.searchChatIndex({ root, keyword }).then(result => {
        if (!active) return
        if (result.ok) setMatches(result.matches)
        else setError(result.error)
      }).catch(error => { if (active) setError(String(error)) }).finally(() => { if (active) setLoading(false) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [root, keyword])
  async function open(match: ChatIndexSearchMatch) {
    setOpening(true)
    try { await onOpen(match) } catch (error) { setError(String(error)) }
    finally { setOpening(false) }
  }
  return <div className="indexed-search-results"><div className="indexed-search-title">全部记录搜索 · {loading ? '搜索中…' : `${matches.length} 条${matches.length === 30 ? '（最近匹配）' : ''}`}</div>
    <p className="indexed-search-note">基于已完成的本地索引，建立进度可在设置的“缓存与索引”中查看。</p>
    {error && <p role="alert">{error}</p>}
    {matches.map((match, index) => <button className="conv indexed-search-match" type="button" disabled={opening} key={`${match.conversationId}:${match.id}:${index}`} onClick={() => void open(match)}><div className="mid"><div className="line1"><span className="nm"><SafeText>{match.conversationName}</SafeText></span><span className="tm">{new Date(match.createdAt).toLocaleDateString('zh-CN')}</span></div><div className="pv"><SafeText>{match.text}</SafeText></div></div></button>)}
    {!loading && !error && !matches.length && <p className="indexed-search-note">索引中暂未找到匹配记录</p>}
  </div>
}
