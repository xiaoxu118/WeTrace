import assert from 'node:assert/strict'
import { buildPersonProfile } from '../src/main/person-profile-pipeline.ts'

const start = 1_700_000_000_000
const hour = 3_600_000
const category = '兴趣爱好'
const signal = new AbortController().signal
const contextLimit = error => error.message === 'context-limit'
const inputOf = prompt => JSON.parse(prompt.split('\n输入：').at(-1))

function message(text, index) {
  const anchor = { id: String(index), text, createdAt: start + index * hour, target: true, speaker: 0 }
  return { anchor, messages: [anchor], serverId: String(index + 1), cursor: [anchor.createdAt, index, 'fixture'] }
}

function reader(clips, pageSize = 20, lookup) {
  const requests = []
  const snapshot = { from: start, to: clips.at(-1).anchor.createdAt, count: clips.length, through: clips.at(-1).cursor }
  return { requests, snapshot, read: async query => {
    requests.push(query)
    if (query.lookup) return lookup(query.lookup)
    const offset = query.after ? query.after[1] + 1 : 0
    const end = Math.min(offset + pageSize, clips.length)
    return { snapshot: offset ? undefined : snapshot, clips: clips.slice(offset, end),
      next: end < clips.length ? clips[end - 1].cursor : undefined }
  } }
}

function lead(ref, detail, options = {}) {
  return { category, detail, kind: 'explicit', question: '', references: [ref], ...options }
}

function approval(item, fields = {}) {
  const references = fields.references ?? [item.excerpts[0].ref]
  return {
    candidate: item.candidate, decision: 'approve', category: item.leads[0].category,
    detail: item.leads[0].detail, kind: 'explicit', references,
    checks: references.map(ref => ({ ref, usage: 'literal' })),
    confidence: 3, value: 2, reason: '本人明确表达了这项长期兴趣。', ...fields,
  }
}

const clips = Array.from({ length: 65 }, (_, index) => message(`虚构消息 ${index}`, index))
clips[0] = message('我从小住在虚构城。', 0)
clips[15] = message('我喜欢拍鸟。', 15)
clips[61] = message('长'.repeat(1000) + '我平时也喜欢徒步。', 61)
clips[62].serverId = clips[61].serverId
clips[63] = message(' \u200b ', 63)
const full = reader(clips)
const received = new Set()
const progress = []
const result = await buildPersonProfile(full.read, async prompt => {
  const input = inputOf(prompt)
  if (prompt.startsWith('你是人物画像审核员')) return JSON.stringify({ results: input.items.map(item => approval(item)) })
  if (prompt.startsWith('你负责按主题') || prompt.startsWith('你负责对已经审核')) return '{"groups":[]}'
  if (input.length > 12) throw new Error('context-limit')
  return JSON.stringify(input.flatMap(({ ref, text }) => {
    received.add(text)
    if (text.includes('徒步')) return [lead(ref, '喜欢徒步')]
    if (text.includes('拍鸟')) return [lead(ref, '喜欢拍鸟', { references: [ref, 999_999] })]
    if (text.includes('虚构城')) return [lead(ref, '在虚构城长大', { category: '基础信息' })]
    return []
  }))
}, contextLimit, signal, line => progress.push(line))
assert.equal(full.requests.length, 4)
assert.deepEqual(full.requests[1].through, full.snapshot.through)
assert.equal(result.analyzedMessages, 63)
assert.ok(received.has(clips[64].anchor.text))
assert.ok(received.has(clips[0].anchor.text))
assert.ok([...received].some(text => text.endsWith('我平时也喜欢徒步。')))
assert.ok(!received.has(clips[62].anchor.text))
assert.ok(progress.some(line => line.includes('65 / 65')))
assert.deepEqual(new Set(result.observations.map(item => item.detail)), new Set(['在虚构城长大', '喜欢徒步', '喜欢拍鸟']))
assert.ok(result.observations.every(item => item.references.every(ref => result.evidence[ref - 1])))

const short = reader(clips.slice(0, 2))
let malformedReplies = 0
const recovered = await buildPersonProfile(short.read, async prompt => {
  const input = inputOf(prompt)
  if (prompt.startsWith('你是人物画像审核员')) {
    return '审核结果：\n```json\n' + JSON.stringify({ results: input.items.map(item => approval(item)) }) + '\n```'
  }
  if (input.length > 1) {
    malformedReplies++
    return '[{"category":"基础信息"'
  }
  return '<think>省略</think>' + JSON.stringify({ findings: [
    lead(String(input[0].ref), '在虚构城长大', { category: '基础信息' }),
  ] })
}, contextLimit, signal, () => {})
assert.equal(malformedReplies, 2)
assert.equal(recovered.observations[0].detail, '在虚构城长大')

const singletonRefs = new Set()
const singleton = await buildPersonProfile(reader(clips.slice(0, 12)).read, async prompt => {
  const input = inputOf(prompt)
  if (prompt.startsWith('你是人物画像审核员')) return JSON.stringify({ results: input.items.map(item => approval(item)) })
  if (input.length > 1) return '[{"category":"基础信息"'
  const [{ ref, text }] = input
  singletonRefs.add(ref)
  if (text.includes('虚构城')) return JSON.stringify({ findings: [lead(String(ref), '在虚构城长大', { category: '基础信息' })] })
  return JSON.stringify({ excluded: { ref: ` ${ref} `, tone: 'playful' } })
}, contextLimit, signal, () => {})
assert.equal(singletonRefs.size, 12, '大批次格式持续出错时可拆到单条，仍覆盖全部消息')
assert.deepEqual(singleton.observations.map(item => item.detail), ['在虚构城长大'], '仅返回排除项也能完成提取')

await assert.rejects(buildPersonProfile(short.read, async () => '模型说明', contextLimit, signal, () => {}),
  /提取画像线索时.*本次画像未保存/)
const aborted = new AbortController()
aborted.abort()
await assert.rejects(buildPersonProfile(short.read, async () => '', contextLimit, aborted.signal, () => {}), { name: 'AbortError' })

const dialogue = [
  message('我也是', 0),
  message('后来想了下，猫是替人照顾的。', 1),
  message('我是今日摸鱼总裁。', 2),
  message('刚才总裁是在接上面的梗。', 3),
  message('我一向喜欢徒步，尤其喜欢周末走山路。', 4),
  message('周末最喜欢做的事是走山路。', 5),
  message('我还偏爱树荫多的路线。', 6),
  ...Array.from({ length: 6 }, (_, i) => message(`明确自述 ${i + 1}`, 7 + i)),
]
const bird = { ...message('这几年每周我都去观鸟。', 0), serverId: 'bird-anchor' }
bird.messages.unshift({ ...bird.anchor, id: 'context', target: false, speaker: 1, text: '你也喜欢看鸟？' })
const detailed = reader(dialogue, 20, async lookup => {
  assert.deepEqual(lookup, { keyword: '观鸟' })
  return { clips: [bird] }
})
const dubious = '是否只是回应上一句话？'
let requested = false
let mergedCat = false
const checked = await buildPersonProfile(detailed.read, async prompt => {
  const input = inputOf(prompt)
  if (prompt.startsWith('你负责按主题')) {
    const ids = input.filter(item => /养猫|替人照顾/.test(item.detail)).map(item => item.id)
    return JSON.stringify([ids.map(String)])
  }
  if (prompt.startsWith('你负责对已经审核')) {
    const ids = input.filter(item => /徒步|走山路/.test(item.detail)).map(item => item.id)
    return JSON.stringify({ groups: [ids] })
  }
  if (prompt.startsWith('你是人物画像审核员')) {
    const interest = input.items.find(item => item.leads.some(lead => lead.question === dubious))
    if (interest && !requested) {
      requested = true
      assert.ok(input.canLookup)
      return JSON.stringify({ lookups: [{ candidate: interest.candidate, keyword: '观鸟' }] })
    }
    return JSON.stringify({ results: input.items.map(item => {
      const detail = item.leads[0].detail
      if (item === interest) {
        const source = item.excerpts.find(excerpt => excerpt.text === bird.anchor.text)
        assert.equal(source.context.before[0].text, '你也喜欢看鸟？')
        return approval(item, { detail: '喜欢观鸟', decision: 'narrow', value: 3,
          reason: '本人明确说多年来每周观鸟。', references: [source.ref] })
      }
      if (item.leads.some(lead => lead.detail === '养猫')) {
        assert.equal(item.leads.length, 2)
        mergedCat = true
        return approval(item, { decision: 'reject', confidence: 1, reason: '后来澄清是替人照顾。' })
      }
      if (detail === '常用玩笑接梗') return approval(item, { category: '性格与行为', kind: 'inferred',
        references: item.excerpts.map(excerpt => excerpt.ref),
        checks: item.excerpts.map(excerpt => ({ ref: excerpt.ref, usage: 'interaction' })),
        scenes: item.excerpts.map(excerpt => ({ ref: excerpt.ref, scene: '摸鱼总裁的同一段对话' })),
        reason: '两条发言发生在同一个话题。' })
      if (detail === '明确自述 1') return approval(item, { decision: 'pending', confidence: 1, reason: '缺少主语信息。' })
      if (detail === '明确自述 2') return approval(item, { value: 1 })
      if (detail === '喜欢徒步') return approval(item, { detail: '喜欢徒步，偏好周末走山路', value: 3 })
      if (detail === '喜欢走山路') return approval(item, { value: 2 })
      return approval(item)
    }) })
  }
  return JSON.stringify(input.flatMap(({ ref, text }) => {
    if (text === '我也是') return [lead(ref, '可能喜欢观鸟', { kind: 'inferred', question: dubious }), lead(ref, '养猫', { category: '基础信息' })]
    if (text.includes('替人照顾')) return [lead(ref, '替人照顾猫', { category: '基础信息', question: '是否推翻养猫？' })]
    if (text.includes('总裁')) return [lead(ref, '常用玩笑接梗', { category: '性格与行为', kind: 'inferred' })]
    if (text.includes('徒步')) return [lead(ref, '喜欢徒步')]
    if (text.includes('山路')) return [lead(ref, '喜欢走山路')]
    if (text.includes('树荫')) return [lead(ref, '偏爱树荫多的路线')]
    return [lead(ref, text)]
  }))
}, contextLimit, signal, () => {})
assert.ok(mergedCat)
assert.deepEqual(detailed.requests.filter(request => request.lookup), [{ through: detailed.snapshot.through, lookup: { keyword: '观鸟' } }])
assert.equal(checked.observations.length, 8)
const details = checked.observations.map(item => item.detail)
assert.deepEqual(new Set(details.slice(0, 2)), new Set(['喜欢观鸟', '喜欢徒步，偏好周末走山路']))
assert.ok(details.includes('偏爱树荫多的路线'), '保留同一主题下独立成立的偏好')
assert.equal(details.at(-1), '明确自述 2')
assert.ok(!['养猫', '常用玩笑接梗', '喜欢走山路', '明确自述 1'].some(detail => details.includes(detail)))
const birdResult = checked.observations.find(item => item.detail === '喜欢观鸟')
assert.deepEqual(birdResult.review, { confidence: 3, value: 3, reason: '本人明确说多年来每周观鸟。' })
assert.equal(checked.evidence[birdResult.references[0] - 1].messages[0].text, bird.messages[0].text)

let malformedAudits = 0
let candidateToRetry
const corrected = await buildPersonProfile(short.read, async prompt => {
  const input = inputOf(prompt)
  if (prompt.startsWith('你负责按主题') || prompt.startsWith('你负责对已经审核')) return '{"groups":[]}'
  if (!prompt.startsWith('你是人物画像审核员')) return JSON.stringify(input.map(item => lead(item.ref, item.text)))
  const [first, second] = input.items
  if (malformedAudits++ === 0) return JSON.stringify({ results: [approval(first), approval(first, { confidence: 1 })] })
  if (malformedAudits === 2) {
    candidateToRetry = second.candidate
    const ref = first.excerpts[0].ref
    return JSON.stringify([
      { ...approval(first), candidate: String(first.candidate), confidence: '3', value: '2', references: String(ref),
        checks: { ref: String(ref), usage: 'Literal' } },
      approval(second, { references: [ref] }),
    ])
  }
  assert.deepEqual(input.items.map(item => item.candidate), [candidateToRetry])
  return JSON.stringify({ results: input.items.map(item => approval(item)), lookups: [] })
}, contextLimit, signal, () => {})
assert.equal(malformedAudits, 3, '重复或串用引用的候选需要补审，格式兼容的候选直接通过')
assert.equal(corrected.observations.length, 2)

let fallbackAudits = 0
let unusableCandidate
const partialReview = await buildPersonProfile(short.read, async prompt => {
  const input = inputOf(prompt)
  if (prompt.startsWith('你负责按主题') || prompt.startsWith('你负责对已经审核')) return '{"groups":[]}'
  if (!prompt.startsWith('你是人物画像审核员')) return JSON.stringify(input.map(item => lead(item.ref, item.text)))
  fallbackAudits++
  const [first, second] = input.items
  if (!second) {
    assert.equal(first.candidate, unusableCandidate)
    return '{"results":['
  }
  unusableCandidate = second.candidate
  return JSON.stringify({ results: [approval(first), approval(second, { checks: [] })] })
}, contextLimit, signal, () => {})
assert.equal(fallbackAudits, 3)
assert.equal(partialReview.observations.length, 1, '格式始终不合格的候选不会阻止保留已审核的结果')

const single = reader(clips.slice(0, 1))
await assert.rejects(buildPersonProfile(single.read, async prompt => {
  if (prompt.startsWith('你是人物画像审核员')) return '{"results":['
  return JSON.stringify(inputOf(prompt).map(item => lead(item.ref, item.text)))
}, contextLimit, signal, () => {}), /模型未返回可用的审核结果/)

const toneClips = [
  message('奉奶茶王国之命，我任命你为今日珍珠总管。', 0),
  message('火星气象局长在此，今天有罐头雨。', 1),
  message('抽象航空公司是我开的，每张机票只要一块月饼。', 2),
  message('邻居原话是「我经营一家猫咪书店」。', 3),
  message('当然啊，那就当我以后常住火星吧。', 4),
  message('我平时确实喜欢徒步，今年每个月都会去。', 5),
  message('玩之前我用纸印了三张机票。', 6),
  message('我是猫王，统领整个小区的四脚神兽。', 7),
  message('他和我说「从小就在海岛长大」。', 8),
  message('我就住月球背面，你出门就能找到我。', 9),
]
const knownJoke = toneClips[2]
const toneReader = reader(toneClips, 20, async lookup => {
  assert.deepEqual(lookup, { keyword: '抽象航空公司' })
  // Lookup can assign a fresh excerpt number to a source seen during extraction.
  return { clips: [structuredClone(knownJoke)] }
})
const toneReviews = new Map()
const toneResult = await buildPersonProfile(toneReader.read, async prompt => {
  const input = inputOf(prompt)
  if (prompt.startsWith('你负责按主题') || prompt.startsWith('你负责对已经审核')) return '{"groups":[]}'
  if (prompt.startsWith('你是人物画像审核员')) {
    const company = input.items.find(item => item.leads[0].detail === '开航空公司')
    if (company && company.excerpts.length === 1) {
      assert.ok(input.canLookup)
      return JSON.stringify({ lookups: [{ candidate: company.candidate, keyword: '抽象航空公司' }] })
    }
    return JSON.stringify({ results: input.items.map(item => {
      const detail = item.leads[0].detail
      toneReviews.set(detail, item)
      const ref = item.excerpts[0].ref
      if (detail === '常用虚构身份接梗') {
        const scenes = ['讨论奶茶时的虚构任命', '聊天气时的假新闻播报']
        return approval(item, {
          kind: 'inferred', value: 3, references: item.excerpts.map(excerpt => excerpt.ref),
          checks: item.excerpts.map(excerpt => ({ ref: excerpt.ref, usage: 'interaction' })),
          scenes: item.excerpts.map((excerpt, index) => ({ ref: excerpt.ref, scene: scenes[index] })),
          reason: '两个不同话题都出现了虚构身份接梗。',
        })
      }
      if (detail === '持有气象局职位') return approval(item, { checks: [{ ref, usage: 'playful' }], value: 3 })
      if (detail === '担任珍珠总管') return approval(item, { checks: [{ ref, usage: 'interaction' }], value: 3 })
      if (detail === '经营猫咪书店') return approval(item, { checks: [{ ref, usage: 'quoted' }], value: 3 })
      if (detail === '计划常住火星') return approval(item, { checks: [{ ref, usage: 'uncertain' }], value: 3 })
      if (detail === '住在月球背面') assert.equal(item.excerpts[0].flaggedTone, 'uncertain')
      if (item === company) {
        const extra = item.excerpts.find(excerpt => excerpt.text === knownJoke.anchor.text)
        assert.ok(extra)
        return approval(item, { references: [extra.ref], value: 3, reason: '按字面把段子当作本人自述。' })
      }
      return approval(item)
    }) })
  }
  const refs = input.map(item => item.ref)
  return JSON.stringify({
    excluded: [
      null,
      { ref: '无效引用', tone: 'quoted' },
      { ref: String(refs[2]), tone: 'playful' },
      { ref: String(refs[9]), tone: '反话' },
    ],
    findings: [
      lead(refs[0], '常用虚构身份接梗', { category: '性格与行为', kind: 'inferred', tone: 'playful',
        question: '是否在多个独立话题出现？', references: refs.slice(0, 2) }),
      lead(refs[0], '担任珍珠总管', { category: '基础信息' }),
      lead(refs[1], '持有气象局职位', { category: '基础信息' }),
      lead(refs[3], '经营猫咪书店', { category: '基础信息' }),
      lead(refs[4], '计划常住火星', { category: '基础信息', tone: 'uncertain', kind: 'inferred' }),
      lead(refs[5], '喜欢徒步', { tone: 'literal' }),
      lead(refs[6], '开航空公司', { category: '基础信息', kind: 'inferred', question: '印机票是在玩游戏还是经营航空业务？' }),
      lead(refs[7], '是猫王', { category: '基础信息', tone: 'playful' }),
      lead(refs[8], '在海岛长大', { category: '基础信息', tone: 'quoted' }),
      lead(refs[9], '住在月球背面', { category: '基础信息', tone: 'literal' }),
    ],
  })
}, contextLimit, signal, () => {})
assert.ok(!toneReviews.has('是猫王') && !toneReviews.has('在海岛长大'), '提取阶段过滤玩梗和转述的字面结论')
assert.deepEqual(toneReader.requests.filter(request => request.lookup).map(request => request.lookup), [{ keyword: '抽象航空公司' }])
assert.deepEqual(toneResult.observations.map(item => item.detail), ['常用虚构身份接梗', '喜欢徒步'],
  '玩梗支持独立场合的交流方式，不能支持字面事实，补查也不能把已排除的段子改为自述')
assert.ok(toneResult.evidence.every(clip => clip.anchor.text !== knownJoke.anchor.text))

const groupingProgress = []
const groupingFallback = await buildPersonProfile(short.read, async prompt => {
  const input = inputOf(prompt)
  if (prompt.startsWith('你负责按主题')) return '{"groups":[[1,2]'
  if (prompt.startsWith('你负责对已经审核')) return '{"groups":[[1,999]]}'
  if (prompt.startsWith('你是人物画像审核员')) {
    assert.ok(input.items.every(item => item.leads.length === 1))
    return JSON.stringify({ results: input.items.map(item => approval(item)) })
  }
  return JSON.stringify(input.map(item => lead(item.ref, item.text)))
}, contextLimit, signal, line => groupingProgress.push(line))
assert.equal(groupingFallback.observations.length, 2)
assert.equal(groupingProgress.filter(line => line.endsWith('保留原有条目')).length, 2)

const diaryExamples = [
  '生日当天本来休息，后来仍去上班。',
  '该周周六休息。',
  '正在减肥。',
  '当天预约了十二点清洗洗衣机，服务人员提前到达。',
  '提到过某天在单位睡觉。',
  '有工作单位，有同事。',
]
const profileExamples = [
  ...diaryExamples,
  '从事售后支持工作',
  '在做售后支持',
  '有无线电维修经历',
  '通常周末休息',
  '和熟人互损时用了一句粗口甲',
  '在另一场熟人玩笑里加了一句粗口乙',
  '那次群友拿成人话题开玩笑，我跟着接梗',
  '另一个话题也用成人玩笑回应',
  '我一直有做体重管理的习惯',
  '生日当天仍去上班，生日是农历八月初九。',
  '生日是农历八月初九，当天看了场电影。',
]
const durable = reader(profileExamples.map(message), 30)
const workTopic = '工作与学习'
const longTerm = await buildPersonProfile(durable.read, async prompt => {
  const input = inputOf(prompt)
  if (prompt.startsWith('你负责按主题')) return '{"groups":[]}'
  if (prompt.startsWith('你负责对已经审核')) {
    assert.ok(input.every(item => !diaryExamples.includes(item.detail)))
    const duplicate = input.filter(item => item.detail.includes('售后支持')).map(item => item.id)
    return JSON.stringify({ groups: [duplicate] })
  }
  if (prompt.startsWith('你是人物画像审核员')) {
    return JSON.stringify({ results: input.items.map(item => {
      const lead = item.leads[0]
      const fields = { value: lead.detail === '从事售后支持工作' ? 3 : lead.detail === '通常周末休息' ? 1 : 2 }
      if (lead.kind === 'explicit' || lead.detail === '有身材焦虑') return approval(item, fields)
      const references = item.excerpts.map(excerpt => excerpt.ref)
      return approval(item, { ...fields, kind: 'inferred', references,
        checks: references.map(ref => ({ ref, usage: 'interaction' })),
        scenes: references.map((ref, index) => ({ ref, scene: `独立话题 ${index}` })),
      })
    }) })
  }
  const literal = input.flatMap(({ ref, text }, index) => {
    if (index >= 10 && index <= 13) return []
    const topic = [6, 7, 9].includes(index) ? workTopic : index === 8 ? '长期经历' : '生活习惯'
    return [lead(ref, text, { category: '基础信息', topic })]
  })
  return JSON.stringify([
    ...literal,
    lead(input[10].ref, '熟人调侃时会用粗口', {
      category: '性格与行为', topic: '交流表达', kind: 'inferred', references: [input[10].ref, input[11].ref],
    }),
    lead(input[12].ref, '曾在不同玩笑语境下接成人话题的梗', {
      category: '性格与行为', topic: '交流表达', kind: 'inferred', references: [input[12].ref, input[13].ref],
    }),
    lead(input[2].ref, '有身材焦虑', {
      category: '性格与行为', topic: '生活习惯', kind: 'inferred', references: [input[2].ref, input[14].ref],
    }),
  ])
}, contextLimit, signal, () => {})
const durableDetails = longTerm.observations.map(item => item.detail)
assert.deepEqual(durableDetails.slice(0, 2), ['从事售后支持工作', '通常周末休息'])
assert.ok(durableDetails.includes('熟人调侃时会用粗口'))
assert.ok(durableDetails.includes('曾在不同玩笑语境下接成人话题的梗'))
assert.ok(durableDetails.includes('我一直有做体重管理的习惯'))
assert.equal(durableDetails.filter(detail => detail === '生日是农历八月初九').length, 1, '保留明确的农历生日并去重')
assert.ok(durableDetails.every(detail => !detail.includes('生日当天') && !detail.includes('看了场电影')), '剔除和生日混在同一句的临时行程')
assert.ok(!durableDetails.includes('在做售后支持') && !durableDetails.includes('有身材焦虑'))
assert.ok(diaryExamples.every(detail => !durableDetails.includes(detail)))

const behaviorCases = [
  { text: '周末郊游的话，先问问大家什么时候有空，再定出发时间。', situation: '朋友讨论郊游', action: '先确认大家能出发的时间', pattern: '组织活动前先确认他人的限制' },
  { text: '聚餐先问一下有没有人不能吃辣，我再挑地方。', situation: '家人讨论聚餐', action: '先确认是否有人忌口', pattern: '组织活动前先确认他人的限制' },
  { text: '我来看看你那个路由器是怎么回事。', situation: '朋友说同一个路由器坏了', action: '主动帮忙排查', pattern: '主动帮忙解决问题' },
  { text: '还是刚才那个路由器，我正在看。', situation: '同一轮讨论中的跟进', action: '汇报这次排查', pattern: '主动帮忙解决问题' },
  { text: '今晚见，先确认在哪个门口集合。', situation: '一次聚会', action: '问集合位置', pattern: '提前协调聚会安排' },
]
const behaviorClips = behaviorCases.map(({ text }, index) => message(text, index))
behaviorClips[2].messages.push(behaviorClips[3].anchor)
behaviorClips[3].messages.unshift(behaviorClips[2].anchor)
const behaviorReader = reader(behaviorClips, 1)
const behaviorProfile = await buildPersonProfile(behaviorReader.read, async prompt => {
  const input = inputOf(prompt)
  if (prompt.startsWith('你负责按主题')) {
    assert.ok(input.every(item => item.behavior?.action && item.behavior?.situation))
    return JSON.stringify({ groups: ['组织活动前先确认他人的限制', '主动帮忙解决问题'].map(pattern =>
      input.filter(item => item.behavior.pattern === pattern).map(item => item.id)) })
  }
  if (prompt.startsWith('你负责对已经审核')) return '{"groups":[]}'
  if (prompt.startsWith('你是人物画像审核员')) {
    return JSON.stringify({ results: input.items.map(item => {
      const [lead] = item.leads
      const pattern = lead.behavior.pattern
      if (pattern === '提前协调聚会安排') {
        // A behavior clue cannot be promoted by relabeling its one-off event as an explicit fact.
        return approval(item, { category: '基础信息', kind: 'explicit' })
      }
      assert.equal(item.leads.length, 2)
      const refs = item.excerpts.map(excerpt => excerpt.ref)
      assert.ok(item.leads.every(lead => lead.references.length && lead.references.every(ref => refs.includes(ref))))
      return approval(item, {
        kind: 'inferred',
        detail: pattern === '组织活动前先确认他人的限制' ? '组织亲友共同活动时，倾向先确认各自的限制再做安排' : '遇到朋友求助时会主动接手排查',
        references: refs,
        checks: refs.map(ref => ({ ref, usage: 'interaction' })),
        scenes: refs.map((ref, index) => ({ ref, scene: `场合 ${index + 1}` })),
      })
    }) })
  }
  return JSON.stringify(input.map(({ ref, text }) => {
    const { situation, action, pattern } = behaviorCases.find(item => item.text === text)
    return lead(ref, action, { category: '性格与行为', kind: 'inferred', behavior: { situation, action, pattern } })
  }))
}, contextLimit, signal, () => {})
assert.deepEqual(behaviorProfile.observations.map(item => item.detail),
  ['组织亲友共同活动时，倾向先确认各自的限制再做安排'])
assert.equal(behaviorProfile.observations[0].references.length, 2)

console.log('画像分页、待核实线索、逐条审核、证据约束、去重精选及取消测试通过')
