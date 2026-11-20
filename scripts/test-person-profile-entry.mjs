import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const start = Date.UTC(2024, 0, 1)
const target = { kind: 'contact', root: 'fixture-account', contactId: 'fixture-contact' }
const otherTarget = { ...target, contactId: 'fixture-other-contact' }
const heldReads = new Map()
const candidateClips = [
  '我在虚构城长大。',
  '观鸟是我最喜欢的活动。',
  '刚给猫换了个窝。',
  '我有一本纸质台历。',
  '我乃云朵管理局局长，明天给每人发两朵云。',
].map((text, index) => {
  const anchor = { id: String(index), text, createdAt: start + index * 3_600_000, target: true, speaker: 0 }
  return { anchor, messages: [anchor], cursor: [anchor.createdAt, index, 'fixture'] }
})
const cat = candidateClips[2]
const reply = { id: 'reply', text: '那是朋友托你照顾几天的猫吧？', createdAt: cat.anchor.createdAt + 1000, target: false, speaker: 1 }
const correction = { id: 'correction', text: '对，是朋友的猫。', createdAt: reply.createdAt + 1000, target: true, speaker: 0 }
const clips = [...candidateClips, { anchor: correction, messages: [correction] }]
  .sort((first, second) => first.anchor.createdAt - second.anchor.createdAt)
const through = candidateClips.at(-1).cursor
const snapshot = { from: start, to: through[0], count: clips.length, through }
const stages = []
const leads = [
  { category: '基础信息', detail: '在虚构城长大', kind: 'explicit', question: '是否属于本人自述？' },
  { category: '兴趣爱好', detail: '喜欢观鸟', kind: 'explicit', question: '是否明确表达长期兴趣？' },
  { category: '基础信息', detail: '可能养猫', kind: 'inferred', question: '猫是本人的还是朋友的？' },
  { category: '其他', detail: '有纸质台历', kind: 'explicit', question: '是否有长期查阅价值？' },
  { category: '基础信息', detail: '担任云朵管理局局长', kind: 'explicit', question: '是否是虚构头衔？' },
]
let controller = new AbortController()
let cancelNextPage = false
let lookupFailures = 1
let extractionReads = 0
let dedupFailures = 0
let mergeFailures = 0
let pageFailures = 0
let paginated = false
const pageQueries = []
const checkpoints = new Map()
const fixture = {
  loadProfileCheckpoint: (key, modelKey) => {
    const saved = checkpoints.get(key)
    return saved?.modelKey === modelKey ? structuredClone(saved.checkpoint) : undefined
  },
  saveProfileCheckpoint: (key, modelKey, checkpoint) => checkpoints.set(key, { modelKey, checkpoint: structuredClone(checkpoint) }),
  removeProfileCheckpoint: key => checkpoints.delete(key),
  listModelConfigs: () => [{ id: 'fixture-model', kind: 'text', source: 'remote', isDefault: true }],
  resolveReportModel(id, kind) {
    assert.equal(id, 'fixture-model')
    assert.equal(kind, 'text')
    return { id }
  },
  createPersonProfileReader(actualTarget) {
    assert.deepEqual(actualTarget, actualTarget.contactId === otherTarget.contactId ? otherTarget : target)
    const held = heldReads.get(actualTarget.contactId)
    const read = async query => {
      if (held) await held.ready
      if (!query.lookup) {
        extractionReads++
        pageQueries.push(query)
        if (!paginated) return { clips, snapshot }
        if (!query.after) return { clips: clips.slice(0, 2), snapshot, next: clips[1].cursor }
        if (cancelNextPage) {
          cancelNextPage = false
          controller.abort()
        }
        if (pageFailures > 0) {
          pageFailures--
          throw new Error('测试第二页读取中断')
        }
        return { clips: clips.slice(2) }
      }
      stages.push('查证')
      if (lookupFailures > 0) {
        lookupFailures--
        throw new Error('读取微信记录超时，请重新同步')
      }
      assert.deepEqual(query.lookup, { at: cat.cursor })
      assert.deepEqual(query.through, through)
      return { clips: [{ ...cat, messages: [cat.anchor, reply, correction] }] }
    }
    return Object.assign(read, { close() {
      if (held) {
        held.closed = true
        held.release()
      }
    } })
  },
  async callReportModel(model, prompt, _progress, options) {
    assert.equal(model.id, 'fixture-model')
    assert.equal(options.signal, controller.signal)
    const input = JSON.parse(prompt.split('\n输入：').at(-1))
    if (prompt.startsWith('你负责从一批聊天')) {
      stages.push('提取')
      return JSON.stringify(leads.flatMap((lead, index) => {
        const evidence = input.find(excerpt => excerpt.text === candidateClips[index].anchor.text)
        return evidence ? [{ ...lead, references: [evidence.ref] }] : []
      }))
    }
    if (prompt.startsWith('你负责按主题归并')) {
      stages.push('归并')
      if (mergeFailures > 0) { mergeFailures--; throw new Error('测试归并中断') }
      return '{"groups":[]}'
    }
    if (prompt.startsWith('你负责对已经审核通过')) {
      stages.push('去重')
      if (dedupFailures > 0) { dedupFailures--; throw new Error('测试去重模型中断') }
      assert.deepEqual(new Set(input.map(item => item.detail)), new Set(['喜欢观鸟', '在虚构城长大', '有纸质台历']))
      return '{"groups":[]}'
    }
    assert.match(prompt, /^你是人物画像审核员/)
    stages.push('审核')
    const catItem = input.items.find(item => item.leads[0].detail === '可能养猫')
    assert.equal(catItem.leads[0].question, leads[2].question)
    if (!catItem.excerpts[0].context) {
      assert.equal(input.canLookup, true)
      return JSON.stringify({ lookups: [{ candidate: catItem.candidate, ref: catItem.excerpts[0].ref }] })
    }
    assert.deepEqual(catItem.excerpts[0].context.after.map(message => message.text), [reply.text, correction.text])
    return JSON.stringify({ results: input.items.map(item => {
      const { category, detail, kind } = item.leads[0]
      if (item === catItem) {
        return { candidate: item.candidate, decision: 'reject', confidence: 1, value: 2, reason: '本人澄清是朋友的猫。' }
      }
      return {
        candidate: item.candidate, decision: 'approve', category, detail, kind,
        references: [item.excerpts[0].ref], confidence: 3, value: detail === '喜欢观鸟' ? 3 : detail === '有纸质台历' ? 1 : 2,
        checks: [{ ref: item.excerpts[0].ref, usage: detail === '担任云朵管理局局长' ? 'playful' : 'literal' }],
        reason: '本人明确自述。', scenes: [],
      }
    }) })
  },
}

// Keep the real entry and pipeline. Replace the modules that would access WeChat or a model service.
const entry = new URL('../src/main/person-profile.ts', import.meta.url)
const fixtureKey = 'wetrace.person-profile-entry-fixture'
const stubs = new Map([
  ['./model-config-store', 'export const { listModelConfigs, resolveReportModel } = fixture'],
  ['./wechat', 'export const { createPersonProfileReader } = fixture'],
  ['./person-profile-checkpoint-store', 'export const { loadProfileCheckpoint, saveProfileCheckpoint, removeProfileCheckpoint } = fixture'],
  ['./report-model', 'export const { callReportModel } = fixture; export class ModelContextLimitError extends Error {}'],
])
globalThis[fixtureKey] = fixture
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.split('?')[0] === entry.href) {
      if (stubs.has(specifier)) return { url: `fixture:${specifier}`, shortCircuit: true }
      if (specifier === './person-profile-pipeline') return next(new URL(specifier + '.ts', entry).href, context)
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    const source = url.startsWith('fixture:') && stubs.get(url.slice('fixture:'.length))
    if (!source) return next(url, context)
    return {
      format: 'module', shortCircuit: true,
      source: `const fixture = globalThis[${JSON.stringify(fixtureKey)}]; ${source}`,
    }
  },
})
try {
  const { generatePersonProfile, clearPersonProfileCheckpoint } = await import(entry.href)
  const progress = []
  const result = await generatePersonProfile(target, controller.signal, detail => progress.push(detail))
  assert.deepEqual(stages, ['提取', '归并', '审核', '查证', '查证', '审核', '去重'])
  assert.ok(progress.some(detail => detail.includes('正在重试 1/2')))
  assert.deepEqual(result.observations.map(item => [item.detail, item.review]), [
    ['喜欢观鸟', { confidence: 3, value: 3, reason: '本人明确自述。' }],
    ['在虚构城长大', { confidence: 3, value: 2, reason: '本人明确自述。' }],
    ['有纸质台历', { confidence: 3, value: 1, reason: '本人明确自述。' }],
  ])
  assert.deepEqual(result.observations.map(item => result.evidence[item.references[0] - 1].anchor.text),
    [candidateClips[1].anchor.text, candidateClips[0].anchor.text, candidateClips[3].anchor.text])
  clearPersonProfileCheckpoint(target)
  stages.length = 0
  lookupFailures = 3
  await assert.rejects(generatePersonProfile(target, controller.signal, () => {}), /读取微信记录超时/)
  assert.deepEqual(stages, ['提取', '归并', '审核', '查证', '查证', '查证'])
  stages.length = 0
  progress.length = 0
  const resumed = await generatePersonProfile(target, controller.signal, detail => progress.push(detail))
  assert.deepEqual(resumed, result)
  assert.deepEqual(stages, ['查证', '审核', '去重'])
  assert.equal(extractionReads, 2, '审核阶段失败后，重试不重新读取提取阶段的聊天')
  assert.ok(progress.some(detail => detail.includes('复用已完成批次')))

  clearPersonProfileCheckpoint(target)
  dedupFailures = 1
  await assert.rejects(generatePersonProfile(target, controller.signal, () => {}), /测试去重模型中断/)
  stages.length = 0
  const restarted = await import(entry.href + '?restart')
  const deduplicated = await restarted.generatePersonProfile(target, controller.signal, () => {})
  assert.deepEqual(deduplicated, result)
  assert.deepEqual(stages, ['去重'], '去重阶段失败后，从去重继续')
  assert.equal(extractionReads, 3)

  stages.length = 0
  const readyToSave = await restarted.generatePersonProfile(target, controller.signal, () => {})
  assert.deepEqual(readyToSave, result)
  assert.deepEqual(stages, [], '尚未写入的结果可直接再次尝试保存')
  assert.equal(extractionReads, 3)
  restarted.clearPersonProfileCheckpoint(target)

  paginated = true
  pageFailures = 1
  pageQueries.length = 0
  stages.length = 0
  const paginationRun = await import(entry.href + '?pagination')
  await assert.rejects(paginationRun.generatePersonProfile(target, controller.signal, () => {}), /第二页读取中断/)
  assert.deepEqual(pageQueries.map(query => query.after), [undefined, clips[1].cursor])
  assert.deepEqual(stages, ['提取'])
  const pageRestarted = await import(entry.href + '?page-restart')
  pageQueries.length = 0
  stages.length = 0
  mergeFailures = 1
  await assert.rejects(pageRestarted.generatePersonProfile(target, controller.signal, () => {}), /归并中断/)
  assert.deepEqual(pageQueries.map(query => query.after), [clips[1].cursor])
  assert.deepEqual(stages, ['提取', '归并'])
  const mergeRestarted = await import(entry.href + '?merge-restart')
  pageQueries.length = 0
  stages.length = 0
  const merged = await mergeRestarted.generatePersonProfile(target, controller.signal, () => {})
  assert.deepEqual(merged, result)
  assert.deepEqual(pageQueries, [])
  assert.equal(stages[0], '归并')
  mergeRestarted.clearPersonProfileCheckpoint(target)
  const cancellationRun = await import(entry.href + '?cancellation')
  cancelNextPage = true
  stages.length = 0
  await assert.rejects(cancellationRun.generatePersonProfile(target, controller.signal, () => {}), { name: 'AbortError' })
  assert.deepEqual(stages, ['提取'])
  assert.equal(checkpoints.size, 1, '取消保留已完成的提取页')
  controller = new AbortController()
  const afterCancel = await import(entry.href + '?after-cancel')
  pageQueries.length = 0
  assert.deepEqual(await afterCancel.generatePersonProfile(target, controller.signal, () => {}), result)
  assert.deepEqual(pageQueries.map(query => query.after), [clips[1].cursor])
  afterCancel.clearPersonProfileCheckpoint(target)
  for (const { contactId } of [target, otherTarget]) {
    const held = { closed: false }
    held.ready = new Promise(resolve => { held.release = resolve })
    heldReads.set(contactId, held)
  }
  const firstController = new AbortController()
  const first = afterCancel.generatePersonProfile(target, firstController.signal, () => {})
  const second = afterCancel.generatePersonProfile(otherTarget, controller.signal, () => {})
  await assert.rejects(afterCancel.generatePersonProfile(target, controller.signal, () => {}), /已有画像正在生成/)
  firstController.abort()
  await assert.rejects(first, { name: 'AbortError' })
  assert.equal(heldReads.get(target.contactId).closed, true)
  assert.equal(heldReads.get(otherTarget.contactId).closed, false)
  heldReads.get(otherTarget.contactId).release()
  assert.deepEqual(await second, result)
  assert.equal(heldReads.get(otherTarget.contactId).closed, true)
  afterCancel.clearPersonProfileCheckpoint(target)
  afterCancel.clearPersonProfileCheckpoint(otherTarget)
  console.log('画像入口验证通过：各阶段续接、不同对象并行、同对象防重以及独立取消')
} finally {
  hooks.deregister()
  delete globalThis[fixtureKey]
}
