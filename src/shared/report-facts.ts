import { reportMemberKey, reportMemberName } from './report-messages.ts'
import type { SyncMessage } from './types'

export interface ReportParticipant { key: string; id?: string; name: string; count: number; avatar?: string }
export function reportFacts(messages: SyncMessage[]) {
  const members = new Map<string, ReportParticipant>()
  let firstAt: number | undefined, lastAt: number | undefined
  for (const message of messages) {
    if (Number.isFinite(message.createdAt)) {
      firstAt = firstAt === undefined ? message.createdAt : Math.min(firstAt, message.createdAt)
      lastAt = lastAt === undefined ? message.createdAt : Math.max(lastAt, message.createdAt)
    }
    if ([10000, 10002].includes(message.messageType) || message.sender === '微信系统消息') continue
    const key = reportMemberKey(message)
    if (!key) continue
    const member = members.get(key) ?? { key, id: message.senderId, name: reportMemberName(message), count: 0, avatar: message.avatar }
    member.count++
    members.set(key, member)
  }
  const participants = [...members.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
  return { firstAt, lastAt, participantCount: participants.length, members: participants, participants: participants.slice(0, 5) }
}
