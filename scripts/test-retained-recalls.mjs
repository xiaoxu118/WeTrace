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
