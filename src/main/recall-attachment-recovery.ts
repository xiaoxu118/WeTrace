import { inspectLocalVideoHashes, videoUnavailable } from './local-video.ts'
import type { Dirent } from 'node:fs'
import { readLocalAttachment } from './local-attachment.ts'
import { retainMedia } from './recall-media-store.ts'
import { conversationCacheAllowed } from './conversation-cache-policy.ts'
import type { MonitorState } from '../shared/group-monitor'

const recoveryOffsets = new Map<string, number>()

/** A download may finish after the original database row was replaced by its recall notice. */
export function recoverCapturedAttachments(state: MonitorState, root: string, key: string, resolveVideoFilename?: (hash: string) => string | undefined, options: { budgetMs?: number; now?: () => number } = {}): void {
  const directories = new Map<string, Dirent[]>()
  const clock = options.now || Date.now, started = clock()
  const pending = state.rooms.filter(room => conversationCacheAllowed(root, room.id)).flatMap(room => room.messages
    .filter(message => message.media?.file && !message.media.file.source || message.media?.video?.hashes?.length && !message.media.video.source || [43, 62].includes(message.type >>> 0) && !message.media?.video)
    .map(message => ({ room, message })))
  if (!pending.length) { recoveryOffsets.delete(root); return }
  let index = (recoveryOffsets.get(root) || 0) % pending.length
  for (let count = 0; count < pending.length; count++) {
    if (clock() - started >= (options.budgetMs ?? Infinity)) break
    const { room, message } = pending[index]
    index = (index + 1) % pending.length

    const video = message.media?.video || ([43, 62].includes(message.type >>> 0) ? {} : undefined)
    if (video && !video.source) {
      try {
        const { data, reason } = inspectLocalVideoHashes(root, room.id, video.hashes || [], resolveVideoFilename)
        const source = data && retainMedia(root, key, room.id, data, 'video/mp4')
        message.media = { ...message.media, video: { ...video, source, unavailable: source ? undefined : data ? '视频尚未保存' : videoUnavailable(reason || 'not-found') } }
      } catch { /* Retry when a complete video becomes available. */ }
    }
    const file = message.media?.file
    if (!file || file.source) continue
    try {
      const attachment = readLocalAttachment(root, room.id, file, directories)
      const source = attachment && retainMedia(root, key, room.id, attachment.data, attachment.mime)
      if (!source) continue
      message.media = { ...message.media, file: { ...file, source, unavailable: undefined } }
      if (attachment?.mime.startsWith('image/')) message.media.image = { source, thumbnail: false }
      if (attachment?.mime === 'video/mp4') message.media.video = { source }
    } catch { /* A failed retry cannot damage metadata or an existing capture. */ }
  }
  recoveryOffsets.set(root, index)
}
