import assert from 'node:assert/strict'
import { preserveConversationAvatars } from '../src/shared/conversation-avatars.ts'
const message = (id, senderId, avatar) => ({ id, senderId, avatar, createdAt: 1000, messageType: 1, from: 'them', text: '测试消息', time: '12:00' })
const previous = { id: 'fixture@chatroom', type: 'group', avatar: 'group-avatar', messages: [message('2', 'alice', 'alice-avatar'), message('3', 'bob', 'bob-avatar')] }
const incoming = { ...previous, avatar: undefined, messages: [message('1', 'alice'), message('2', 'alice'), message('3', 'bob'), message('4', 'charlie')] }
const result = preserveConversationAvatars(incoming, previous)
assert.equal(result.avatar, 'group-avatar')
assert.deepEqual(result.messages.map(item => item.avatar), ['alice-avatar', 'alice-avatar', 'bob-avatar', undefined])
assert.equal(incoming.messages[0].avatar, undefined)
const updated = preserveConversationAvatars({ ...incoming, messages: [message('1', 'alice'), message('2', 'alice', 'new-avatar')] }, previous)
assert.deepEqual(updated.messages.map(item => item.avatar), ['new-avatar', 'new-avatar'])
assert.equal(preserveConversationAvatars(incoming, { ...previous, id: 'other@chatroom' }), incoming)
assert.equal(preserveConversationAvatars(incoming), incoming)
const unknown = preserveConversationAvatars({ ...incoming, messages: [message('5', undefined)] }, { ...previous, messages: [message('6', undefined, 'unknown-avatar')] })
assert.equal(unknown.messages[0].avatar, undefined)
console.log('头像保留测试通过：历史分页、成员隔离、头像更新、未知成员和会话隔离。')
