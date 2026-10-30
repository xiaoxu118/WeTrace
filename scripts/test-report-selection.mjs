import assert from 'node:assert/strict'
import { selectReportMessages } from '../src/shared/report-selection.ts'
import { ReportSnapshotStore } from '../src/main/report-snapshots.ts'
import { filterReportMessages, reportMemberKey } from '../src/shared/report-messages.ts'
import { reportFacts } from '../src/shared/report-facts.ts'
const at = new Date(2026, 9, 30, 12).getTime()
const source = [
  { id: 'one', createdAt: at, from: 'them', sender: '外层角色', messageType: 1, text: '不选中的内容', time: '12:00' },
  { id: 'forward', createdAt: at + 1000, from: 'them', sender: 'Re', senderId: 're', messageType: 49, text: '外层转发说明', time: '12:00', forwarded: { title: '群聊记录', entries: [
    { sender: '内部甲', text: '只选这一条', time: '2026-10-26 10:00:00' },
    { sender: '内部乙', text: '不要选这一条', time: '2026-10-26 10:01:00' },
    { sender: '内部甲', text: '[视频]', messageType: 43 },
  ] } },
  { id: 'voice', createdAt: at + 2000, from: 'me', sender: '账号昵称', messageType: 34, text: '[语音]', voice: { hex: '1234' }, time: '12:00', quote: { sender: '其他人', text: '未选上下文' } },
]
const ref = (index, entryIndex) => ({ id: source[index].id, createdAt: source[index].createdAt, ...(entryIndex === undefined ? {} : { entryIndex }) })
const selected = selectReportMessages(source, [ref(1, 0), ref(2)])
assert.deepEqual(selected.map(message => message.sender), ['内部甲', '账号昵称'])
assert.equal(reportMemberKey(selected[0]), 'name:内部甲')
assert.equal(selected[0].text, '只选这一条')
assert.equal(selected[0].createdAt, new Date(2026, 9, 26, 10).getTime())
assert.equal(selected[1].voice.hex, '1234')
assert.equal(selected[1].quote, undefined, '不会额外发送未选中的引用上下文')
assert.equal(selectReportMessages(source, [ref(1), ref(1, 0)]).length, 3, '整个转发与单条重叠时去重')
assert.equal(reportFacts(selected).participantCount, 2)
assert.ok(!JSON.stringify(selected).includes('外层角色') && !JSON.stringify(selected).includes('外层转发说明'))
assert.throws(() => selectReportMessages(source, []), /请选择/)
assert.throws(() => selectReportMessages(source, [ref(1, 99)]), /已变化/)
assert.throws(() => selectReportMessages(source, [{ ...ref(0), id: 'deleted' }]), /不存在/)
assert.throws(() => selectReportMessages(source, [ref(0, -1)]), /无效/)
let reads = 0
const snapshot = new ReportSnapshotStore(async query => {
  reads++
  assert.deepEqual(query.selectedMessages, [ref(1, 0), ref(2)])
  assert.equal(query.metadataOnly, undefined)
  return { ...query, counts: {}, messages: source }
})
const loaded = await snapshot.load(3, { root: '/account', conversationId: 'room', selectedMessages: [ref(1, 0), ref(2)] })
assert.equal(loaded.messages.length, 2)
assert.equal(loaded.messages[1].voice, undefined, '音频不传入配置页面')
const input = { root: '/account', conversationId: 'room', snapshotId: loaded.snapshotId, startDate: '2026-10-26', endDate: '2026-10-30', contentTypes: ['message', 'voice'] }
const data = await snapshot.forGeneration(3, input)
assert.deepEqual(data.messages.map(message => message.text), ['只选这一条', '[语音]'])
assert.deepEqual(data.counts, { message: 1, voice: 1, image: 0, video: 0 })
assert.equal(reads, 1, '只在进入配置时读取选中原文，后续配置与生成复用')
assert.equal(snapshot.get(3, { ...input, contentTypes: ['message'] }).messages.length, 1)
assert.throws(() => snapshot.get(4, input), /已失效/)
assert.equal(filterReportMessages(selectReportMessages(source, [ref(1)]), { ...input, contentTypes: ['video'] }).messages.length, 1)
console.log('消息选择测试通过：精确范围、转发内部身份与时间、重复去重、排除上下文、失效提示、缓存与统计一致。')
