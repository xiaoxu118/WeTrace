import assert from 'node:assert/strict'
import { ReportSnapshotStore } from '../src/main/report-snapshots.ts'
import { reportMemberKey, filterReportMessages } from '../src/shared/report-messages.ts'

const messages = [
  { id: '1', messageType: 1, createdAt: new Date(2026, 9, 1, 12).getTime(), text: '第一天', senderId: 'me', sender: '我' },
  { id: '2', messageType: 34, createdAt: new Date(2026, 9, 2, 12).getTime(), text: '[语音]', senderId: 'alice', sender: '成员甲', voice: { hex: '1234' }, reportMedia: { content: 'private metadata' } },
  { id: '3', messageType: 3, createdAt: new Date(2026, 9, 2, 13).getTime(), text: '[图片]' },
  { id: '4', messageType: 43, createdAt: new Date(2026, 9, 2, 14).getTime(), text: '[视频]' },
].map(item => ({ from: item.id === '1' ? 'me' : 'them', time: '12:00', ...item }))
let reads = 0
const store = new ReportSnapshotStore(async query => {
  reads++
  assert.deepEqual(query.contentTypes, ['message', 'voice', 'image', 'video'])
  assert.equal(query.deferMedia, true)
  assert.equal(query.includeVoiceData, undefined)
  assert.equal(query.startDate, '1970-01-01')
  return { ...query, messages, counts: { message: 1, voice: 1, image: 1, video: 1 } }
})
const loaded = await store.load(1, { root: '/account', conversationId: 'chat' })
assert.equal(loaded.messages[0].text, '', '配置界面仅接收筛选所需元数据，不传输整段正文')
assert.equal(loaded.messages[1].voice, undefined, '原始音频只留在主进程')
assert.equal(loaded.messages[1].reportMedia, undefined, '延迟处理的素材元数据只留在主进程')
for (let i = 0; i < loaded.messages.length; i++) assert.equal(reportMemberKey(loaded.messages[i]), reportMemberKey(messages[i]), '界面与后端成员标识一致')
assert.equal(reportMemberKey(loaded.messages[0]), 'self')
assert.equal(reportMemberKey(loaded.messages[1]), 'id:alice')
assert.equal(loaded.messages[1].sender, '成员甲')
const input = { root: '/account', snapshotId: loaded.snapshotId, conversationId: 'chat', startDate: '2026-10-01', endDate: '2026-10-02', contentTypes: ['message'] }
assert.deepEqual(store.get(1, input).messages.map(item => item.id), ['1'])
assert.deepEqual(store.get(1, { ...input, contentTypes: ['voice'] }).messages.map(item => item.id), ['2'])
assert.equal(store.get(1, { ...input, contentTypes: ['voice'] }).messages[0].voice.hex, '1234')
assert.deepEqual(store.get(1, { ...input, startDate: '2026-10-02', contentTypes: ['message', 'image', 'video'] }).messages.map(item => item.id), ['3', '4'])
assert.deepEqual(store.get(1, { ...input, contentTypes: ['message'] }).counts, { message: 1, voice: 1, image: 1, video: 1 })
assert.equal(reads, 1, '日期、内容勾选及生成只做内存筛选')
assert.throws(() => store.get(2, input), /已失效/)
assert.throws(() => store.get(1, { ...input, root: '/other-account' }), /已失效/)
assert.throws(() => store.get(1, { ...input, contentTypes: [] }), /至少选择/)
assert.throws(() => filterReportMessages(messages, { ...input, startDate: '2026-02-30' }), /日期无效/)
assert.equal(filterReportMessages(messages, { ...input, contentTypes: [] }).messages.length, 0)
const refreshed = await store.load(1, { root: '/account', conversationId: 'chat' })
assert.equal(reads, 2, '重新选择会话获取最新数据')
assert.notEqual(refreshed.snapshotId, loaded.snapshotId)
assert.throws(() => store.get(1, input), /已失效/)
store.clear(1)
assert.throws(() => store.get(1, { ...input, snapshotId: refreshed.snapshotId }), /已失效/)

const pending = new Map()
const raceStore = new ReportSnapshotStore(query => new Promise(resolve => pending.set(query.conversationId, () => resolve({ ...query, messages, counts: {} }))))
const oldLoad = raceStore.load(1, { conversationId: 'old' })
const oldRejected = assert.rejects(oldLoad, /会话选择已变化/)
const newLoad = raceStore.load(1, { conversationId: 'new' })
pending.get('new')()
const newest = await newLoad
pending.get('old')()
await oldRejected
assert.equal(raceStore.get(1, { ...input, root: undefined, snapshotId: newest.snapshotId, conversationId: 'new' }).messages.length, 1)
let detailReads = 0
const indexedStore = new ReportSnapshotStore(async query => {
  if (query.metadataOnly) return { ...query, counts: {}, messages: messages.map(message => ({ ...message, text: '', voice: undefined })), indexRevision: 'revision-1' }
  detailReads++
  assert.equal(query.startDate, '2026-10-02')
  assert.deepEqual(query.contentTypes, ['voice'])
  assert.equal(query.indexRevision, 'revision-1')
  return filterReportMessages(messages, query)
})
const indexed = await indexedStore.load(7, { root: '/account', conversationId: 'chat' })
assert.equal(detailReads, 0)
const generated = await indexedStore.forGeneration(7, { ...input, snapshotId: indexed.snapshotId, startDate: '2026-10-02', contentTypes: ['voice'] })
assert.equal(detailReads, 1)
assert.equal(generated.messages[0].voice.hex, '1234')
assert.equal(generated.messages.length, 1)
const aggregates = filterReportMessages([{ ...messages[0], count: 123 }, { ...messages[1], count: 456 }], { ...input, contentTypes: ['message', 'voice'] })
assert.equal(aggregates.counts.message, 123)
assert.equal(aggregates.counts.voice, 456)
console.log('会话缓存测试通过：每次选择只读取一次、配置与生成复用、日期/类型筛选、账号隔离、刷新及快速切换保护。')

const rangedReads = []
const rangedStore = new ReportSnapshotStore(async query => {
  assert.notEqual(query.startDate, '1970-01-01', '近期报告不能先读取全部历史')
  rangedReads.push(query)
  return filterReportMessages(messages, query)
})
const firstDay = await rangedStore.load(30, { root: '/account', conversationId: 'chat', startDate: '2026-10-01', endDate: '2026-10-01' })
assert.deepEqual(firstDay.messages.map(message => message.id), ['1'])
const firstDayInput = { ...input, snapshotId: firstDay.snapshotId, startDate: '2026-10-01', endDate: '2026-10-01' }
assert.equal((await rangedStore.forGeneration(30, firstDayInput)).messages[0].text, '第一天', '原始记录回退后的正文可直接用于生成')
assert.equal(rangedReads.length, 1, '相同日期范围生成时复用原文')
assert.throws(() => rangedStore.get(30, { ...firstDayInput, endDate: '2026-10-02' }), /日期范围已变化/)
const secondDay = await rangedStore.load(30, { root: '/account', conversationId: 'chat', startDate: '2026-10-02', endDate: '2026-10-02' })
assert.deepEqual(secondDay.messages.map(message => message.id), ['2', '3', '4'])
assert.deepEqual(rangedReads.map(query => [query.startDate, query.endDate]), [['2026-10-01', '2026-10-01'], ['2026-10-02', '2026-10-02']])
await assert.rejects(rangedStore.load(30, { conversationId: 'chat', startDate: '2026-10-02', endDate: '2026-10-01' }), /开始日期/)
console.log('报告日期范围回归通过：按日加载、切换日期、原文复用、范围失效保护和日期校验。')
const pendingRanges = new Map()
const rangeRace = new ReportSnapshotStore(query => new Promise(resolve => pendingRanges.set(query.startDate, () => resolve(filterReportMessages(messages, query)))))
const oldRange = rangeRace.load(31, { root: '/account', conversationId: 'chat', startDate: '2026-10-01', endDate: '2026-10-01' })
const oldRangeRejected = assert.rejects(oldRange, /会话选择已变化/)
const newRange = rangeRace.load(31, { root: '/account', conversationId: 'chat', startDate: '2026-10-02', endDate: '2026-10-02' })
pendingRanges.get('2026-10-02')()
const newestRange = await newRange
pendingRanges.get('2026-10-01')()
await oldRangeRejected
assert.equal(rangeRace.get(31, { ...input, snapshotId: newestRange.snapshotId, startDate: '2026-10-02', endDate: '2026-10-02', contentTypes: ['voice'] }).messages[0].id, '2')
console.log('同一会话快速切换日期时，迟到读取不会覆盖最新范围。')
