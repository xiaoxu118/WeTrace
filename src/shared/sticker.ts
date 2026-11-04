export interface StickerQuery { root?: string; md5?: string; cdnUrl?: string }
export type StickerResponse = { ok: true; source: string } | { ok: false; error: string }
