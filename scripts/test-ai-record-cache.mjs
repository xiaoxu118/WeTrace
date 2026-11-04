import assert from 'node:assert/strict'
import { AiRecordCache } from '../src/main/ai-record-cache.ts'
let reads = 0, version = 'a'
const cache = new AiRecordCache(1024, 60000, 2)
const read = async () => { reads++; return { text: '记录' } }
const revision = () => version
assert.equal((await cache.get('account:room:range', revision, read)).cached, false)
assert.equal((await cache.get('account:room:range', revision, read)).cached, true)
assert.equal(reads, 1)
version = 'b'
assert.equal((await cache.get('account:room:range', revision, read)).cached, false)
await cache.get('other-account', revision, read)
await cache.get('new-range', revision, read)
assert.equal((await cache.get('account:room:range', revision, read)).cached, false)
let moving = 0
assert.equal((await cache.get('changing', () => String(moving++), read)).cached, false)
assert.equal((await cache.get('changing', () => String(moving++), read)).cached, false)
const expired = new AiRecordCache(1024, -1)
await expired.get('a', revision, read)
assert.equal((await expired.get('a', revision, read)).cached, false)
const tiny = new AiRecordCache(1)
await tiny.get('a', revision, read)
assert.equal((await tiny.get('a', revision, read)).cached, false)
const controller = new AbortController(); controller.abort()
await assert.rejects(() => cache.get('a', revision, read, controller.signal))
console.log('AI record cache: reuse, source invalidation, range/account isolation, LRU, TTL, memory bound and cancellation passed')

const concurrentCache = new AiRecordCache(30,60000,10)
let release
const gate = new Promise(resolve=>{release=resolve})
const pendingA=concurrentCache.get('same',()=> 'v1',async()=>{await gate;return {value:'x'}})
const pendingB=concurrentCache.get('same',()=> 'v1',async()=>{await gate;return {value:'x'}})
release();await Promise.all([pendingA,pendingB])
await concurrentCache.get('other',()=> 'v1',async()=>({value:'y'}))
assert.equal((await concurrentCache.get('same',()=> 'v1',async()=>{throw new Error('duplicate bytes caused premature eviction')})).cached,true)
const isolated=new AiRecordCache()
const abortOne=new AbortController()
let finishReads
const waitForReads=new Promise(resolve=>{finishReads=resolve})
const cancelledRead=isolated.get('shared',()=> 'v1',async()=>{await waitForReads;return '结果'},abortOne.signal)
const survivingRead=isolated.get('shared',()=> 'v1',async()=>{await waitForReads;return '结果'})
const cancellation=assert.rejects(cancelledRead,/abort/i)
abortOne.abort();finishReads()
await cancellation
assert.equal((await survivingRead).data,'结果')
console.log('并行对话缓存：相同键容量计数准确，取消一个请求不影响另一个请求通过')
