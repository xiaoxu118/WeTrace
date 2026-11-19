import { localImages, presentMessage } from './message-content.ts'
import { readImagePreview } from './image-preview-cache.ts'
import { retainMedia } from './recall-media-store.ts'
import type { SyncMessage } from '../shared/types'

/** Resolve from saved hashes rather than looking for the now-revoked database row. */
export function refreshOriginalImage(root: string, key: string, room: string, saved: NonNullable<SyncMessage['image']>, resolvePath?: (hash: string) => string | undefined): NonNullable<SyncMessage['image']> {
  if (saved.source && saved.thumbnail === false) return saved
  const hashes = saved.hashes?.filter(hash => /^[a-f\d]{32}$/i.test(hash)) || []
  if (!hashes.length) throw new Error('撤回前未保存原图定位信息，无法补取原图')
  const content = hashes.map(hash => `<img md5="${hash}"/>`).join('')
  const image = presentMessage(3, content, localImages(root, room, resolvePath)).image
  if (!image?.source || image.thumbnail) return saved.source ? saved : image || saved
  const preview = readImagePreview(image.source.split('/').at(-1) || '')
  const source = preview && retainMedia(root, key, room, preview.data, preview.mime)
  return { ...image, source: source || image.source }
}
