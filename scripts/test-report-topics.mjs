import { reportMemberName } from '../src/shared/report-messages.ts'
import assert from 'node:assert/strict'
import { cleanReportText, cleanReportSummary, splitReportTopics, topicParticipants, topicMessageCount } from '../src/shared/report-topics.ts'
const members = [{ key: 'alice', name: '成员甲', count: 5 }, { key: 'bob', name: '成员乙', count: 3 }, { key: 'self', name: '我', count: 2 }]
const authors = [{ reference: 'r1', key: 'alice' }, { reference: 'r2', key: 'bob' }, { reference: 'r3', key: 'alice' }, { reference: 'r4', key: 'self' }]
assert.equal(cleanReportText('电脑卡了（#115568、#115570–#115571），明天再发。'), '电脑卡了，明天再发。')
assert.equal(cleanReportText('回复 [r1]。<!-- refs: r1,r2 -->'), '回复。')
assert.equal(cleanReportText('时间 09:24，费用 115568 元，电话13057830225'), '时间 09:24，费用 115568 元，电话13057830225')
assert.equal(cleanReportSummary('本群当日612条消息、0条语音，视频仅计入统计不分析内容。大家讨论早餐和沟通方式。'), '大家讨论早餐和沟通方式。')
assert.deepEqual(topicParticipants('话题<!-- refs: r1,r2,r3 -->', members, authors).map(member => member.key), ['alice', 'bob'])
assert.deepEqual(topicParticipants('话题 [r2–r4]', members, authors).map(member => member.key).sort(), ['alice', 'bob', 'self'])
assert.deepEqual(topicParticipants('本人认为成员甲说得好', members, []).map(member => member.key), ['alice'])
assert.deepEqual(topicParticipants('其他话题', members, authors), [])
assert.equal(splitReportTopics(['### 话题甲', '内容一', '### 话题乙', '内容二']).length, 2)
console.log('日报话题测试通过：引用内部解析、正文隐藏编号、统计型概要清理、按真实引用匹配成员、话题拆分。')

assert.equal(reportMemberName({ from: 'me', sender: '小林', senderId: 'wxid_self' }), '小林')
assert.equal(reportMemberName({ from: 'me', sender: '我', senderId: 'wxid_self' }), '我')
assert.equal(reportMemberName({ from: 'me' }), '我')

assert.equal(topicMessageCount('<!-- refs: r1,r2,r2,r3–r5 -->'), 5)
assert.equal(topicMessageCount('#115568、#115570–#115571、#115570'), 3)
assert.equal(topicMessageCount('09:24，费用100元'), 0)
