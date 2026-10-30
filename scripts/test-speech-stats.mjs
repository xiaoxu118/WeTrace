import assert from 'node:assert/strict'
import { findSilentMembers, formatSpeechStats, silentMembersNote } from '../src/shared/speech-stats.ts'

assert.deepEqual(findSilentMembers(['a', 'b', 'b', 'c', ''], [{ id: 'a' }, { id: 'former' }]), [
  { id: 'b', name: 'b' }, { id: 'c', name: 'c' },
], 'only current members without speech are listed; duplicates and former members are excluded')
assert.equal(findSilentMembers(['a', 'b'], []).length, 2, 'empty time window lists all current members')
assert.deepEqual(findSilentMembers(['a'], [{ id: 'a' }]), [])
const stats = { total: 3, members: [{ id: 'a', name: '张三', count: 3 }], silentMembers: [{ id: 'b', name: '李四' }] }
const copied = formatSpeechStats('测试群', '2026-10-01', '2026-10-29', stats)
for (const text of ['测试群', '2026-10-01', '2026-10-29', '张三：3 条（100.0%）', '未发言成员（1 人）', '李四', silentMembersNote]) assert.ok(copied.includes(text), text)
assert.ok(formatSpeechStats('群', '', '', { total: 0, members: [], silentMembers: null, membershipError: '读取失败' }).includes('未发言名单暂不可用：读取失败'))
assert.ok(formatSpeechStats('群', '', '', { total: 0, members: [], silentMembers: [{ id: 'b', name: '李四' }] }).includes('李四'))
console.log('Speech stats: current membership differences and clipboard output passed')
