import assert from 'node:assert/strict'
import { enrichReportFeedTopics, parseReportFeed, renderReportFeed, reportFeedPolicy } from '../src/shared/report-feed.ts'
import { reportFacts } from '../src/shared/report-facts.ts'

// Match the reported scale without reading user conversations or calling a model.
const messages = Array.from({ length: 9000 }, (_, index) => ({
  id: String(index), messageType: index % 100 === 0 ? 10000 : 1,
  createdAt: new Date(2026, 9, 29).getTime() + index * 16000,
  senderId: `person-${index % 21}`, sender: `成员${index % 21}`, from: 'them',
  time: `${String(Math.floor(index / 60) % 24).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}`,
  text: `针对方案${Math.floor(index / 750)}，本条补充具体问题、不同意见、处理过程和待验证结果。`.repeat(4),
}))
const facts = reportFacts(messages)
const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII='
const first = { ...messages[1], text: '模拟发言' }
const later = { ...first, id: 'later', avatar }
const namesake = { ...first, id: 'namesake', senderId: 'another-member' }
const avatarFacts = reportFacts([first, later, namesake])
assert.equal(avatarFacts.members[0].avatar, avatar, '首条消息没有头像时使用后续消息中的头像')
const avatarHtml = renderReportFeed({
  hero: { summary: '同名成员测试' },
  importantMessages: [{ content: first.text, sourceMessageIds: ['r1'] }],
}, {
  ...avatarFacts, name: '模拟群', startDate: '2026-10-29', endDate: '2026-10-29',
  messageCount: 3, width: 430, warnings: [],
  messageAuthors: [{ reference: 'r1', key: `id:${first.senderId}` }],
  sourceMessages: [{ ...first, reference: 'r1' }],
})
assert.ok(avatarHtml.includes(`class="important-card"><img class="avatar" src="${avatar}"`), '同名成员的重点消息按原文作者取头像')
assert.ok(avatarHtml.includes(`class="rank"><img class="avatar" src="${avatar}"`), '发言排行按成员身份取头像')
const policy = reportFeedPolicy(messages.length, '2026-10-29', '2026-10-30', 'default')
assert.equal(policy.full, true)
assert.equal(policy.maxTopics, 12)
assert.equal(reportFeedPolicy(20, '2026-10-30', '2026-10-30', 'default').maxTopics, 4)
assert.equal(reportFeedPolicy(20, '2026-10-30', '2026-10-30', 'detailed').full, true)
assert.equal(facts.members.reduce((sum, member) => sum + member.count, 0), 8910)
const transcript = messages.map((message, index) => `[r${index + 1}] ${message.time} ${message.sender}：${message.text}`)
const topics = Array.from({ length: 12 }, (_, index) => ({ title: `独立话题${index + 1}`, summary: '讨论了相关内容。', sourceMessageIds: [`r${index * 750 + 3}`, `r${index * 750 + 4}`] }))
let expansions = 0
const detailed = '成员先提出方案中的具体问题，其他参与者补充了不同意见，随后围绕处理过程交换看法。大家尚未给出明确负责人和截止时间，后续仍需验证结果。'.repeat(3)
const data = await enrichReportFeedTopics({ hero: { summary: '两天的讨论涉及多个独立方案。' }, topics }, transcript, policy.maxTopics, async prompt => {
  expansions++
  assert.ok(prompt.includes('原始消息'))
  assert.ok(prompt.includes('处理过程和待验证结果'))
  const reference = /\[(r\d+)\]/.exec(prompt)[1]
  return JSON.stringify({ summary: detailed, sourceMessageIds: [reference], conclusions: [] })
}, () => {})
assert.equal(expansions, 12)
assert.ok(data.topics.every(topic => topic.summary.length >= 120))
const document = { ...facts, name: '模拟两天9000条消息', startDate: '2026-10-29', endDate: '2026-10-30', messageCount: 9000, width: 430, messageAuthors: messages.map((message, index) => ({ reference: `r${index + 1}`, key: `id:${message.senderId}` })), sourceMessages: messages.map((message, index) => ({ reference: `r${index + 1}`, sender: message.sender, text: message.text, time: message.time })), warnings: [] }
const html = renderReportFeed(parseReportFeed(JSON.stringify(data)), document)
assert.equal((html.match(/class="topic-card"/g) ?? []).length, 12, '不再固定截掉第5个以后的话题')
assert.equal((html.match(/class="rank"/g) ?? []).length, 10)
assert.ok(html.includes('发言排行'))
assert.ok(html.includes('9000'))
assert.ok(html.includes(detailed))
for (const member of facts.members.slice(0, 10)) assert.ok(html.includes(`${member.count} 条`))
// Empty model content does not hide facts computed from the original 9000 messages.
const empty = renderReportFeed({ hero: { summary: '没有实质讨论。' }, topics: [] }, document)
assert.equal((empty.match(/class="rank"/g) ?? []).length, 10)
let failures = 0
const partial = await enrichReportFeedTopics({ topics: topics.slice(0, 2) }, transcript, 2, async () => {
  if (++failures === 1) throw new Error('模拟接口失败')
  return JSON.stringify({ summary: detailed, sourceMessageIds: ['r753'] })
}, () => {}, () => {})
assert.equal(partial.topics[0].summary, topics[0].summary)
assert.equal(partial.topics[1].summary, detailed)
const short = await enrichReportFeedTopics({ topics: [{ summary: '短对话', sourceMessageIds: ['r1'] }] }, ['[r1] 你好'], 4, async () => { throw new Error('短对话不应强行扩写') }, () => {})
assert.equal(short.topics[0].summary, '短对话')
console.log('9000条双日记录回归通过：12个话题、原文补充、前10发言排行、系统消息排除、空模型内容及局部失败处理。')
