import type { SyncMessage } from './types'
export interface MonitorMessage {
  id: string
  serverId?: string
  at: number
  sender: string
  text: string
  type: number
  media?: Pick<SyncMessage, 'image' | 'voice' | 'sticker' | 'link' | 'forwarded' | 'quote'>
  revoked?: boolean
  revokeNoticeId?: string
  from?: 'me' | 'them'
  senderId?: string
}
export interface MonitorEvent {
  id: string
  room: string
  kind: 'message' | 'left' | 'joined' | 'revoked'
  at: number
  sender: string
  text: string
  original?: string
}
export interface MonitorRoom {
  id: string
  name: string
  enabled: boolean
  eventKinds?: ('message' | 'left' | 'joined')[]
  startedAt: number
  checkedAt?: number
  retentionLimited?: boolean
  captureGap?: boolean
  snapshot?: { ids: string[]; at: number }
  members?: Record<string, string>
  messages: MonitorMessage[]
  error?: string
}
export interface MonitorState { rooms: MonitorRoom[]; events: MonitorEvent[] }
export interface MonitorQuery { root?: string; action: 'status' | 'poll' | 'configure'; rooms?: { id: string; name: string; enabled: boolean; eventKinds?: ('message' | 'left' | 'joined')[] }[] }
export type MonitorResponse = { ok: true; data: MonitorState } | { ok: false; error: string }
