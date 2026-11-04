import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
function moduleUrl(source) {
  const outputText = stripTypeScriptTypes(source)
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
}
const modelUrl = moduleUrl(fs.readFileSync(new URL('../src/main/report-model.ts', import.meta.url), 'utf8'))
const source = fs.readFileSync(new URL('../src/main/ai-chat-reduction.ts', import.meta.url), 'utf8').replace("'./report-model'", JSON.stringify(modelUrl))
const { prepareConversationMemory, emotionalContextWindows, estimateChatTokens, reduceChatNotes, splitChatText, splitChatRecords, boundedChatHistory, withChatContextBudget } = await import(moduleUrl(source))
let calls = 0
const result = await reduceChatNotes(Array.from({ length: 80 }, (_, i) => `${i}: ${'内容'.repeat(4500)}`), async batch => {
  assert.ok(batch.length <= 18001)
  calls++
  return `摘要 ${calls}`
})
assert.ok(calls > 24)
assert.ok(result.length <= 18001)
const controller = new AbortController()
controller.abort()
await assert.rejects(() => reduceChatNotes(['x'.repeat(19000)], async () => '摘要', controller.signal), /abort/i)
assert.ok((await reduceChatNotes(['x'.repeat(19000)], async () => 'y'.repeat(7000))).length <= 14400, 'over-target summaries remain valid when they fit the capacity threshold')
const fragments = splitChatRecords([{time:'2022-01-02',sender:'虚构成员',text:('开头😀\\\"\n结束').repeat(4000)}], 900)
assert.ok(fragments.every(batch => batch.length <= 900))
const parsed = fragments.flatMap(batch => batch.split('\n').map(line => JSON.parse(line)))
assert.ok(parsed.every(item => item.sender === '虚构成员' && item.time === '2022-01-02'))
assert.equal(parsed.map(item => item.text).join(''), ('开头😀\\\"\n结束').repeat(4000))
assert.deepEqual(splitChatText(['x'.repeat(100),'y'.repeat(100)],100), ['x'.repeat(100),'y'.repeat(100)])
const history = boundedChatHistory(Array.from({length:39},(_,i)=>({role:i%2?'assistant':'user',content:'历史'.repeat(6000)})),1800)
assert.ok(history.length <= 1800)
assert.ok(!history.includes('历史'.repeat(1000)))
const { ModelContextLimitError } = await import(modelUrl)
const budgets = []
assert.equal(await withChatContextBudget(async budget => { budgets.push(budget); if(budget>4000)throw new ModelContextLimitError();return '完成' }), '完成')
assert.deepEqual(budgets,[16000,8000,4000])
await assert.rejects(withChatContextBudget(async()=>{throw new ModelContextLimitError()}),/日期范围未被缩小/)
let otherCalls=0
await assert.rejects(withChatContextBudget(async()=>{otherCalls++;throw new Error('API密钥无效')}),/密钥/)
assert.equal(otherCalls,1)
console.log('AI reduction: multi-level merge, strict budgets, attributed long-message fragments, bounded history, adaptive capacity retry and cancellation passed')

// A single batch can fit the character limit yet require token-driven compression.
const emotionalEvent = '虚构人物：临时取消约定后失落，明确表达需要提前告知；对方道歉后和解。'
let tokenCalls = 0
const compressed = await reduceChatNotes([emotionalEvent + '无关资讯'.repeat(90)], async batch => {
  tokenCalls++
  return batch.includes('虚构人物') ? emotionalEvent : '无关内容已剔除'
}, undefined, 18000, 600)
assert.ok(tokenCalls > 0)
assert.ok(estimateChatTokens(compressed) <= 600)
assert.ok(compressed.includes(emotionalEvent), 'representative emotional event survives compression')
let fittingCalls = 0
assert.equal(await reduceChatNotes([emotionalEvent], async () => { fittingCalls++; return '' }, undefined, 18000, 600), emotionalEvent)
assert.equal(fittingCalls, 0, 'fitting evidence must not undergo unnecessary lossy compression')
assert.ok(estimateChatTokens('情绪😀') > estimateChatTokens('abc'))
console.log('Token-aware compression and representative emotional-event retention passed')

const eventSource = Array.from({length:150}, (_,index) => ({sender:index===70?'小明':'同事',text:index===70?'临时取消让我很失落':'虚构背景'+index}))
assert.deepEqual(emotionalContextWindows(eventSource,'小明',['编造的情绪原话']),[])
assert.deepEqual(emotionalContextWindows(eventSource,'小明',['虚构背景69']),[])
const [eventWindow] = emotionalContextWindows(eventSource,'小明',['临时取消让我很失落','临时取消让我很失落'])
assert.equal(eventWindow[0],30)
assert.equal(eventWindow.at(-1),110)
console.log('Emotion anchors: verified speaker/source, deduplicated wider context passed')

// A compliant model that only reduces by 10% needs more than the old 12-round limit.
let slowRounds = 0
const slow = await reduceChatNotes(['证'.repeat(20000)], async batch => {
  slowRounds++
  return batch.slice(0, Math.floor(batch.length * 0.9))
}, undefined, 1000)
assert.ok(slow.length <= 800)
assert.ok(slowRounds > 12)
let stalledCalls = 0
await assert.rejects(reduceChatNotes(['证'.repeat(1000)], async batch => { stalledCalls++; return batch }, undefined, 800), /连续3次未能压缩/)
assert.ok(stalledCalls > 3)
let abortedCalls = 0
const midAbort = new AbortController()
await assert.rejects(reduceChatNotes(['证'.repeat(2000)], async batch => { abortedCalls++; midAbort.abort(); return batch }, midAbort.signal, 800), /abort/i)
assert.equal(abortedCalls, 1)
console.log('Automatic threshold compaction: over-target output, >12 rounds, stalled recovery and mid-compaction cancellation passed')

let recoveryAttempts = 0
const recovery = await reduceChatNotes(['原始情绪证据'.repeat(300)], async batch => {
  recoveryAttempts++
  if (recoveryAttempts <= 2) return batch + '无效扩写'
  return batch.slice(0, 20)
}, undefined, 1000)
assert.ok(recovery.length <= 800)
assert.ok(recovery.includes('原始情绪证据'))
console.log('Non-shrinking compression retries recover without replacing original evidence')

// Short chats retain complete turns, including assistant text beyond the former 500-character cut.
const scope = JSON.stringify(['/fixture-account','fixture-group'])
let memoryCalls = 0
const shortTurns = [{role:'user',content:'称小明为甲'},{role:'assistant',content:'完整回复'.repeat(150)}]
const intact = await prepareConversationMemory(shortTurns,scope,undefined,async()=>{memoryCalls++;return '不应调用'},4000)
assert.equal(memoryCalls,0)
assert.deepEqual(JSON.parse(intact.history).recent,shortTurns)
const oldTurns = Array.from({length:60},(_,i)=>({role:i%2?'assistant':'user',content:`原始轮次${i}：${i===0?'称小明为甲；后来纠正为乙，继续分析乙的情绪原因。':''}${'虚构背景。'.repeat(100)}`}))
const sourceSeen=[]
const remember = async batch => {memoryCalls++;sourceSeen.push(batch);return '用户纠正：小明称为乙；任务是分析乙的情绪事件原因。助手猜测未证实。'}
const firstMemory = await prepareConversationMemory(oldTurns,scope,undefined,remember,3200)
assert.ok(memoryCalls>0)
assert.ok(firstMemory.memory.coveredTurns>0)
assert.ok(firstMemory.history.includes('用户纠正：小明称为乙'))
assert.ok(firstMemory.history.length<=3200)
for(let i=0;i<firstMemory.memory.coveredTurns;i++) assert.ok(sourceSeen.join('').includes(`原始轮次${i}：`),`every older turn enters compaction: ${i}`)
const persisted = JSON.parse(JSON.stringify(firstMemory.memory))
const beforeReuse=memoryCalls
const continued=await prepareConversationMemory([...oldTurns,{role:'user',content:'继续评价乙'}],scope,persisted,remember,3200)
assert.equal(memoryCalls,beforeReuse,'reopening reuses persisted memory without reprocessing its covered prefix')
assert.ok(continued.history.includes('小明称为乙'))
assert.ok(continued.history.includes('继续评价乙'))
const beforeWrongScope=memoryCalls
await prepareConversationMemory(oldTurns,'different-account',persisted,remember,3200)
assert.ok(memoryCalls>beforeWrongScope,'memory from another source scope is rejected and rebuilt')
const edited=oldTurns.map((turn,index)=>index===0?{...turn,content:'改过的用户要求'}:turn)
const beforeEdit=memoryCalls
await prepareConversationMemory(edited,scope,persisted,remember,3200)
assert.ok(memoryCalls>beforeEdit,'edited transcript invalidates the summary prefix')
assert.equal(persisted.summary,firstMemory.memory.summary,'preparing another request never mutates persisted state')
const failedMemory = new AbortController()
await assert.rejects(prepareConversationMemory(oldTurns,scope,undefined,async()=>{failedMemory.abort();return '记忆'},3200,failedMemory.signal),/abort/i)
console.log('Conversation memory: full recent turns, legacy >40 turns, every prefix turn compacted, persisted reuse, scope isolation, edited history and cancellation passed')

const beforeEmptyMemory=memoryCalls
await prepareConversationMemory(oldTurns,scope,{...persisted,summary:''},remember,3200)
assert.ok(memoryCalls>beforeEmptyMemory,'a damaged empty summary must rebuild instead of dropping its covered history')
