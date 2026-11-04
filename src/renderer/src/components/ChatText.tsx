import { memo, useState } from 'react'
import { splitWechatEmojis, type WechatTextPart } from '../../../shared/wechat-emojis'
import { SafeText } from './SafeText'

// Bundle the community image resources locally so inline faces work offline.
const assets = import.meta.glob('../../../../node_modules/wechat-emojis/assets/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const emojiImages = new Map(Object.entries(assets).map(([path, url]) => [path.split('/').pop()!.slice(0, -4), url]))
function WechatEmoji({ part }: { part: WechatTextPart }) {
  const [failed, setFailed] = useState(false)
  const source = part.name ? emojiImages.get(part.name) : undefined
  return <span role="img" aria-label={part.text} title={source && !failed ? part.text : `${part.text}（通用表情）`} className="wechat-emoji">
    {source && !failed ? <img className="wechat-emoji-image" src={source} alt="" onError={() => setFailed(true)} /> : <SafeText>{part.emoji || part.text}</SafeText>}
  </span>
}
export const ChatText = memo(function ChatText({ children }: { children: string }) {
  return <>{splitWechatEmojis(children, name => emojiImages.has(name)).map((part, index) => part.name
    ? <WechatEmoji key={`${index}:${part.name}`} part={part} /> : <SafeText key={index}>{part.text}</SafeText>)}</>
})
