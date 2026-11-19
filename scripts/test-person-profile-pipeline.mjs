import assert from 'node:assert/strict'
import { buildPersonProfile } from '../src/main/person-profile-pipeline.ts'

const start = 1_700_000_000_000
const hour = 3_600_000
const messages = Array.from({ length: 65 }, (_, index) => {
  const anchor = { id: String(index), createdAt: start + index * hour, text: `虚构消息 ${index}`, target: true, speaker: 0 }
  return { anchor, messages: [anchor], serverId: String(index + 1) }
})
messages[0].anchor.text = '我从小在虚构城长大。'
messages[2].anchor.text = '我在改 bug，明天发给你。'
messages[3].anchor.text = '哈哈，群主被任命为今天的国王。'
messages[15].anchor.text = '我喜欢拍鸟。'
messages[54].anchor.text = '我经常试着把复杂问题拆成小步骤。'
messages[55].anchor.text = '看着复杂，先做第一步，再一步步解决。'
messages[61].anchor.text = '长'.repeat(1000) + '我平时也喜欢徒步。'
messages[62].serverId = messages[61].serverId
messages[63].anchor.text = ' \u200b '
const cursor = index => [messages[index].anchor.createdAt, index, 'fixture']
const snapshot = { from: start, to: cursor(64)[0], count: messages.length, through: cursor(64) }
const requests = [], progress = [], received = new Set()
const read = async query => {
  requests.push(query)
  const offset = query.after ? query.after[1] + 1 : 0
  const end = Math.min(offset + 20, messages.length)
  return { snapshot: offset ? undefined : snapshot, clips: messages.slice(offset, end),
    next: end < messages.length ? cursor(end - 1) : undefined }
}
let audits = 0
const asks = async prompt => {
  const items = JSON.parse(prompt.split('\n输入：').at(-1))
  if (prompt.startsWith('你是独立的')) {
    audits++
    return JSON.stringify(items.filter(item => item.detail !== '明天发给对方').map(item => ({
      category: item.detail === '喜欢拍鸟' ? '兴趣爱好' : item.category,
      detail: item.detail,
      references: item.excerpts.map(excerpt => excerpt.ref),
    })))
  }
  // Simulate a provider that can only handle short batches.
  if (items.length > 12) throw new Error('context-limit')
  return JSON.stringify(items.flatMap(item => {
    received.add(item.text)
    const matches = [
      ['长大', '基础信息', '在虚构城长大'],
      ['明天发给你', '基础信息', '明天发给对方'],
      ['今天的国王', '性格与行为', '在群里戏仿群主'],
      ['拍鸟', '其他', '喜欢拍鸟'],
      ['小步骤', '性格与行为', '遇到复杂问题时倾向分步处理'],
      ['一步步', '性格与行为', '遇到复杂问题时倾向分步处理'],
      ['徒步', '兴趣爱好', '喜欢徒步'],
    ]
    return matches.filter(([keyword]) => item.text.includes(keyword)).map(([, category, detail]) => ({
      category, detail, references: [item.ref, 999_999],
    }))
  }))
}
const controller = new AbortController()
const result = await buildPersonProfile(read, asks, error => error.message === 'context-limit', controller.signal, line => progress.push(line))
assert.equal(requests.length, 4)
assert.deepEqual(requests[1].through, snapshot.through)
assert.equal(result.analyzedMessages, 63)
assert.ok(received.has(messages[64].anchor.text))
assert.ok(received.has(messages[0].anchor.text))
assert.ok([...received].some(text => text.endsWith('我平时也喜欢徒步。')))
assert.ok(!received.has(messages[62].anchor.text))
assert.ok(progress.some(line => line.includes('65 / 65')))
assert.ok(audits >= 1)
assert.deepEqual(result.observations.map(item => [item.category, item.detail]).sort(), [
  ['基础信息', '在虚构城长大'], ['性格与行为', '遇到复杂问题时倾向分步处理'],
  ['兴趣爱好', '喜欢拍鸟'], ['兴趣爱好', '喜欢徒步'],
].sort())
assert.ok(result.observations.every(item => item.references.every(ref => result.evidence[ref - 1])))
assert.ok(result.evidence.some(clip => clip.anchor.text.endsWith('我平时也喜欢徒步。')))
const shortRead = async () => ({
  snapshot: { from: start, to: cursor(1)[0], count: 2, through: cursor(1) },
  clips: messages.slice(0, 2),
})
let malformedReplies = 0
const recovered = await buildPersonProfile(shortRead, async prompt => {
  const items = JSON.parse(prompt.split('\n输入：').at(-1))
  if (prompt.startsWith('你是独立的')) {
    return '审核结果：\n```json\n' + JSON.stringify(items.map(item => ({
      category: item.category, detail: item.detail, references: item.excerpts.map(({ ref }) => ref),
    }))) + '\n```'
  }
  if (items.length > 1) {
    malformedReplies++
    return '[{"category":"基础信息"'
  }
  return '<think>省略</think>' + JSON.stringify({ findings: [{
    category: '基础信息', detail: '在虚构城长大', references: [String(items[0].ref)],
  }] })
}, () => false, controller.signal, () => {})
assert.equal(malformedReplies, 2)
assert.equal(recovered.observations[0].detail, '在虚构城长大')
assert.equal(recovered.observations[0].references.length, 2)
await assert.rejects(buildPersonProfile(shortRead, async () => '模型说明', () => false, controller.signal, () => {}),
  /提取画像信息时.*本次画像未保存/)
const aborted = new AbortController()
aborted.abort()
await assert.rejects(buildPersonProfile(read, asks, () => false, aborted.signal, () => {}), { name: 'AbortError' })
console.log('画像全量分页、独立审核、引用校验及取消测试通过')
