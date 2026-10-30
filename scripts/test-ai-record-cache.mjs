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
