import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyMonitor, observeRoom, loadMonitor, saveMonitor, monitorFile } from '../src/main/group-monitor.ts'
const state = emptyMonitor()
const room = { id: 'test@chatroom', name: '测试群', enabled: true, startedAt: 100000, messages: [] }
state.rooms.push(room)
const msg = (id, text, at = 110, type = 1, serverId = '') => ({ id, text, at: at * 1000, type, sender: '成员甲', serverId })
observeRoom(state, room, [msg('old', '旧消息', 90), msg('1', '原始消息', 110, 1, '123456')], { a: '甲', b: '乙' }, 120)
assert.equal(state.events.length, 1)
assert.equal(state.events[0].kind, 'message')
observeRoom(state, room, [msg('1', '原始消息')], undefined, 130)
assert.equal(state.events.length, 1, '重复轮询不能重复计入消息，名单失败不能产生退群事件')
assert.equal(Object.keys(room.members).length, 2)
observeRoom(state, room, [msg('2', '<revokemsg><msgid>wrong</msgid><newmsgid>123456</newmsgid></revokemsg>', 140, 10002)], { a: '甲', c: '丙' }, 150)
assert.equal(state.events.find(e => e.kind === 'revoked').original, '原始消息')
assert.equal(state.events.find(e => e.kind === 'left').sender, '乙')
assert.equal(state.events.find(e => e.kind === 'joined').sender, '丙')
assert.equal(room.messages.find(m => m.id === '1').text, '原始消息')
observeRoom(state, room, [msg('old', '甲撤回了一条消息', 90, 10000)], undefined, 160)
assert.equal(state.events.at(-1).original, '旧消息', '同一行被替换时应保留原文')
observeRoom(state, room, [msg('3', '甲撤回了一条消息', 170, 10000)], undefined, 180)
assert.equal(state.events.at(-1).original, undefined, '不能猜测未关联的撤回原文')
const count = state.events.length
observeRoom(state, room, [msg('3', '甲撤回了一条消息', 170, 10000)], undefined, 190)
assert.equal(state.events.length, count)
state.events = []
observeRoom(state, room, [msg('3', '甲撤回了一条消息', 170, 10000)], undefined, 200)
assert.equal(state.events.length, 0, '事件过期后不能重复报告已知撤回')
const directory = mkdtempSync(join(tmpdir(), 'wetrace-monitor-'))
try {
 saveMonitor(directory, '/account-a', 'key-a', state)
 assert.ok(!readFileSync(monitorFile(directory, '/account-a')).includes(Buffer.from('原始消息')))
 assert.deepEqual(loadMonitor(directory, '/account-a', 'key-a'), state)
 assert.deepEqual(loadMonitor(directory, '/account-b', 'key-a'), emptyMonitor())
 assert.throws(() => loadMonitor(directory, '/account-a', 'key-b'))
 const file = monitorFile(directory, '/account-a'), bytes = readFileSync(file)
 bytes[bytes.length - 1] ^= 1
 const { writeFileSync } = await import('node:fs'); writeFileSync(file, bytes)
 assert.throws(() => loadMonitor(directory, '/account-a', 'key-a'))
} finally { rmSync(directory, { recursive: true, force: true }) }
console.log('群聊监控测试通过：新消息去重、成员差异、名单失败、两种撤回关联、原文保留、账号隔离、加密与篡改校验。')

const chatState = emptyMonitor()
const chatRoom = { id:'messages@chatroom',name:'消息监控测试群',enabled:true,startedAt:1000500,eventKinds:['message'],messages:[] }
chatState.rooms.push(chatRoom)
observeRoom(chatState,chatRoom,[{id:'new',at:1000000,type:1,sender:'虚构成员',text:'创建后同一秒的新消息'}],undefined,1000600)
assert.equal(chatState.events.length,1,'微信秒级时间不能漏掉创建当秒的新消息')
observeRoom(chatState,chatRoom,[{id:'new',at:1000000,type:1,sender:'虚构成员',text:'创建后同一秒的新消息'},{id:'system',at:1001000,type:10000,sender:'系统',text:'虚构系统通知'}],{one:'甲'},1002000)
assert.equal(chatState.events.length,1,'重复读取和系统通知不能产生聊天消息事件')
observeRoom(chatState,chatRoom,[],{two:'乙'},1003000)
assert.equal(chatState.events.length,1,'仅监控聊天消息时不产生成员变化事件')
console.log('聊天消息监控自测通过：创建当秒采集、重复去重、系统消息过滤、事件类型隔离。')
