import assert from 'node:assert/strict'
import { retainedRecallMessages } from '../src/shared/retained-recalls.ts'
const original = { id: '1', serverId: '100', type: 1, at: 1000, sender: '成员甲', text: '已捕获内容[微笑]', from: 'them', revoked: true, revokeNoticeId: '2' }
const room = { id: 'test@chatroom', name: '测试群', enabled: true, startedAt: 0, messages: [original] }
const message = (id, text = '撤回通知') => ({ id, text, createdAt: 2000, messageType: 10000, from: 'them', time: '12:00' })
assert.equal(retainedRecallMessages([message('2')], room)[0].recall.original, original.text)
assert.equal(retainedRecallMessages([message('2')], room)[0].sender, '成员甲')
assert.equal(retainedRecallMessages([message('1')], room)[0].recall.originalAt, 1000)
assert.equal(retainedRecallMessages([message('1'), message('2')], room).length, 1, '同页已包含原消息时不重复展示撤回原文')
assert.equal(retainedRecallMessages([message('unknown')], room)[0].recall, undefined, '不能按相邻位置或正文猜测关联')
assert.equal(retainedRecallMessages([message('2')])[0].recall, undefined, '没有对应群基线时不能恢复')
const legacyRoom = { ...room, messages: [{ ...original, revokeNoticeId: undefined }, { id: '2', at: 2000, type: 10002, text: '<revokemsg><newmsgid>100</newmsgid></revokemsg>', sender: '系统' }] }
assert.equal(retainedRecallMessages([message('2')], legacyRoom)[0].recall.original, original.text, '兼容此前已捕获的基线')
const mine = retainedRecallMessages([message('2')], { ...room, messages: [{ ...original, from: 'me', sender: '我' }] })[0]
assert.equal(mine.from, 'me')
assert.equal(message('2').recall, undefined, '仅派生展示内容，不修改数据库消息对象')
console.log('撤回原文展示测试通过：同一记录替换、独立通知关联、去重、历史基线兼容、发送方向及未关联回退。')
const imageRoom={...room,messages:[{...original,type:3,media:{image:{source:'wetrace-media://preview/'+'a'.repeat(64)}}}]}
assert.equal(retainedRecallMessages([message('2')],imageRoom)[0].recall.media.image.source,imageRoom.messages[0].media.image.source)
const ambiguous={...room,messages:[{...original,revokeNoticeId:undefined},{...original,id:'other',revokeNoticeId:undefined},{id:'notice',type:10002,at:2000,sender:'系统',text:'<revokemsg><newmsgid>100</newmsgid></revokemsg>'}]}
assert.equal(retainedRecallMessages([message('notice')],ambiguous)[0].recall,undefined,'标识碰撞时不猜测归属')
console.log('媒体保留与标识碰撞回归通过')
const senderRoom = { ...room, avatars: { alice: 'original-avatar', bob: 'other-avatar' }, messages: [{ ...original, senderId: 'alice' }] }
const notice = { ...message('2'), senderId: 'bob', avatar: 'notice-avatar' }
assert.equal(retainedRecallMessages([notice], senderRoom)[0].avatar, 'original-avatar', '独立撤回通知恢复原发言人头像，不采用通知发起人的头像')
assert.equal(retainedRecallMessages([{ ...notice, id: '1' }], senderRoom)[0].avatar, 'original-avatar', '同一记录被替换时也保留原头像')
const legacyAvatars = { ...senderRoom, avatars: undefined }
const currentSender = { ...message('live'), messageType: 1, senderId: 'alice', sender: '成员甲', avatar: 'current-avatar' }
assert.equal(retainedRecallMessages([notice, currentSender], legacyAvatars)[0].avatar, 'current-avatar', '旧缓存可以按发言人标识补全当前会话头像')
assert.equal(retainedRecallMessages([notice, { ...currentSender, senderId: 'someone-else' }], legacyAvatars)[0].avatar, undefined, '同名成员不能混用头像')
const restored = retainedRecallMessages([notice], senderRoom)
assert.equal(retainedRecallMessages(restored, legacyAvatars)[0].avatar, 'original-avatar', '重复派生撤回消息不会再次清空头像')
assert.equal(notice.avatar, 'notice-avatar', '恢复头像不修改原始通知对象')
console.log('撤回头像回归通过：发言人匹配、同一记录/独立通知、旧缓存补全、同名隔离和重复恢复。')
