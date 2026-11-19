import type { ProfileClip } from '../shared/person-profile'

const maxClips = 24

function terms(text: string): Set<string> {
  const normalized = [...text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')]
  return new Set(normalized.slice(1).map((char, index) => normalized[index] + char))
}

function scene(clip: ProfileClip): string {
  const text = clip.messages.map(message => message.text).join(' ')
  if (/不同意|不认同|反对|有异议|不太合适|恐怕不行/.test(text)) return 'disagreement'
  if (/负责|安排|方案|进度|确认|交付|开会/.test(text)) return 'coordination'
  const index = clip.messages.indexOf(clip.anchor)
  if (clip.messages.slice(0, index).some(message => !message.target)) return 'response'
  if (clip.messages.slice(index + 1).some(message => !message.target)) return 'initiative'
  return 'other'
}

export function selectProfileClips(buckets: ProfileClip[][]): ProfileClip[] {
  const accepted: { clip: ProfileClip; terms: Set<string> }[] = []
  const scenes = new Map<string, number>()
  const used = new Set<ProfileClip>()
  const candidates = buckets.map(bucket => bucket.map(clip => ({ clip, scene: scene(clip), terms: terms(clip.anchor.text) })))
  for (let round = 0; round < 6 && accepted.length < maxClips; round++) {
    for (const bucket of candidates) {
      const sorted = [...bucket].sort((a, b) => (scenes.get(a.scene) ?? 0) - (scenes.get(b.scene) ?? 0))
      const item = sorted.find(candidate => !used.has(candidate.clip) && candidate.terms.size >= 2 && !accepted.some(previous => {
        if (Math.abs(candidate.clip.anchor.createdAt - previous.clip.anchor.createdAt) < 20 * 60_000) return true
        const shared = [...candidate.terms].filter(term => previous.terms.has(term)).length
        return shared / (candidate.terms.size + previous.terms.size - shared) >= 0.72
      }))
      if (!item) continue
      used.add(item.clip)
      accepted.push(item)
      scenes.set(item.scene, (scenes.get(item.scene) ?? 0) + 1)
      if (accepted.length === maxClips) break
    }
  }
  return accepted.map(item => item.clip)
}
