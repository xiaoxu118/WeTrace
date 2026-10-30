import type { SpeechStatsResult } from './types'

export const silentMembersNote = '未发言名单以当前群成员和本机聊天记录为准，不代表成员在入群前或其他设备上没有发言。'

export function findSilentMembers(currentIds: string[], speakers: { id: string }[]): { id: string; name: string }[] {
  const spoken = new Set(speakers.map(member => member.id))
  return [...new Set(currentIds)].filter(id => id && !spoken.has(id)).map(id => ({ id, name: id }))
}

export function formatSpeechStats(name: string, start: string, end: string, stats: SpeechStatsResult): string {
  return [
    `群发言分析 · ${name}`,
    `统计时间：${start || '全部历史'} ～ ${end || '至今'}`,
    `发言总数：${stats.total} 条；发言人数：${stats.members.length} 人`,
    '', '发言排行：',
    ...(stats.members.length ? stats.members.map((member, index) => `${index + 1}. ${member.name}：${member.count} 条（${stats.total ? (member.count / stats.total * 100).toFixed(1) : '0.0'}%）`) : ['该时间范围内没有发言记录']),
    '',
    stats.silentMembers === null ? `未发言名单暂不可用：${stats.membershipError || '无法读取当前群成员'}` : `未发言成员（${stats.silentMembers.length} 人）：`,
    ...(stats.silentMembers === null ? [] : stats.silentMembers.length ? stats.silentMembers.map((member, index) => `${index + 1}. ${member.name}`) : ['当前群成员在该时间范围内均有发言记录']),
    '', silentMembersNote,
  ].join('\n')
}
