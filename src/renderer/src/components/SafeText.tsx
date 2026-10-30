import { Fragment, memo, type ReactNode } from 'react'

const segments = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })
const emojiSequence = /\p{Emoji_Presentation}|\p{Regional_Indicator}|\u20E3|\uFE0E|\uFE0F/u

export function firstGrapheme(text: string): string {
  return segments.segment(text)[Symbol.iterator]().next().value?.segment ?? ''
}

// VS16 can force Apple Color Emoji fallback because the outline font has no UVS cmap.
// Only normalize the displayed glyphs; message data and the accessible label retain the original.
// Keep ordinary text in the UI font; only complete emoji clusters use the compatibility font.
export const SafeText = memo(function SafeText({ children }: { children: string }) {
  if (!emojiSequence.test(children)) return <>{children}</>
  const parts: ReactNode[] = []
  let plain = ''
  for (const { segment, index } of segments.segment(children)) {
    if (!emojiSequence.test(segment)) { plain += segment; continue }
    if (plain) { parts.push(<Fragment key={`text-${index}`}>{plain}</Fragment>); plain = '' }
    parts.push(<span className="emoji-text" role="img" aria-label={segment} key={`emoji-${index}`}>{segment.replace(/[\uFE0E\uFE0F]/g, '')}</span>)
  }
  if (plain) parts.push(<Fragment key="tail">{plain}</Fragment>)
  return <>{parts}</>
})
