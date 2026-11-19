// Execute the real query function with fictional members and mocked database access.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { stripTypeScriptTypes } from 'node:module'
import { findSilentMembers, formatSpeechStats } from '../src/shared/speech-stats.ts'
const source = fs.readFileSync('src/main/wechat-records.ts', 'utf8')
const begin = source.indexOf('export function queryWechatSpeechStats(')
const end = source.indexOf('\nexport function ', begin + 1)
let speakers = [{ id: 'fictional-self', name: '我', count: 2 }]
let groupNickname = '群内昵称'
const client = {
  getGroupMemberIds: () => ['fictional-self'],
  getDisplayNames: () => new Map([['fictional-self', '联系人昵称']]),
  getGroupNicknames: () => new Map(groupNickname ? [['fictional-self', groupNickname]] : []),
}
const query = new Function('recordsClient', 'readChatIndex', 'conversationCacheAllowed', 'findSilentMembers', 'reportDateTimestamp', stripTypeScriptTypes(source.slice(begin, end)).replace('export function', 'function') + '; return queryWechatSpeechStats')(
  () => client, (_directory, _account, _key, read) => read({ hasConversation: () => true, speech: () => ({ members: speakers.map(m => ({ ...m })), total: 2, silentMembers: null }) }), () => true, findSilentMembers, () => 0,
)
const run = () => query('/synthetic', { root: '/synthetic', wxid: 'fictional-self' }, 'synthetic-key', { conversationId: 'fictional@chatroom' })
assert.equal(run().members[0].name, '群内昵称')
assert.equal(formatSpeechStats('虚构群', '', '', run()).includes('1. 群内昵称'), true)
groupNickname = ''
assert.equal(run().members[0].name, '联系人昵称')
speakers = []
groupNickname = '群内昵称'
assert.equal(run().silentMembers[0].name, '群内昵称')
console.log('发言分析昵称回归通过：本账号群昵称、联系人昵称回退、未发言名单和复制文本')
