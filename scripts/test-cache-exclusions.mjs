import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatIndex } from '../src/main/chat-index.ts'
import { ReportDiskIndex } from '../src/main/report-disk-index.ts'
import { ReportRecordCache } from '../src/main/report-record-cache.ts'
import { AiRecordCache } from '../src/main/ai-record-cache.ts'
import { ImageDescriptionCache } from '../src/main/image-description-cache.ts'
import { VoiceTranscriptionCache } from '../src/main/voice-transcription-cache.ts'
import { configureConversationCachePolicy, saveExcludedConversations, excludedConversations, conversationCacheAllowed } from '../src/main/conversation-cache-policy.ts'

const directory = mkdtempSync(join(tmpdir(), 'wetrace-exclusions-'))
let index
try {
  configureConversationCachePolicy(join(directory, 'policy'))
  assert.deepEqual(excludedConversations('account'), [])
  assert.throws(() => saveExcludedConversations('account', ['private']), /无效/)
  const room = 'secret@chatroom', other = 'public@chatroom'
  saveExcludedConversations('account', [room, room])
  assert.deepEqual(excludedConversations('account'), [room])
  assert.equal(conversationCacheAllowed('other-account', room), true)
  const stores = [room, other].map(room => ({ id: room, room, tableName: room, dbPath: '' }))
  const calls = []
  let excludeDuringBuild = false
  const source = {
    stores: () => stores,
    excluded: room => !conversationCacheAllowed('account', room),
    watermark: () => ({ count: 1, maxId: 1, types: 1, times: 1, lengths: 7 }),
    page: store => {
      calls.push(store.room)
      if (excludeDuringBuild && store.room === room) setImmediate(() => { saveExcludedConversations('account', [room]); index.exclude([room]) })
      return [{ id: '1', createTime: 1, type: 1, content: 'private', sender: 'a', isSend: false }]
    },
  }
  index = new ChatIndex(join(directory, 'index'), 'account', 'key', 'me')
  await index.start(source)
  assert.deepEqual(calls, [other], 'excluded sources are never read')
  saveExcludedConversations('account', [])
  await index.start(source)
  assert.equal(index.messages(room).length, 1)
  saveExcludedConversations('account', [room]); index.exclude([room])
  assert.equal(index.hasConversation(room), false)
  assert.deepEqual(index.messages(room), [])
  assert.deepEqual(index.search('private').map(item => item.room), [other])
  assert.equal(index.db.prepare('SELECT count(*) AS n FROM staging WHERE room=?').get(room).n, 0)
  index.close(); index = new ChatIndex(join(directory, 'index'), 'account', 'key', 'me')
  assert.equal(index.hasConversation(room), false, 'exclusions survive restart')
  saveExcludedConversations('account', []); excludeDuringBuild = true
  await index.start(source, true)
  assert.deepEqual(index.messages(room), [], 'an in-flight batch cannot restore excluded records')
  assert.equal(index.messages(other).length, 1)

  const disk = new ReportDiskIndex(join(directory, 'reports'))
  const record = conversationId => ({ conversationId, messages: [], counts: {} })
  disk.get('account', 'key', 'secret', () => 'v1', () => record(room))
  disk.get('account', 'key', 'public', () => 'v1', () => record(other))
  disk.exclude('account', 'key', [room])
  let loads = 0
  disk.get('account', 'key', 'secret', () => 'v1', () => { loads++; return record(room) })
  disk.get('account', 'key', 'public', () => 'v1', () => { throw new Error('unrelated cache was deleted') })
  assert.equal(loads, 1)
  const memory = new ReportRecordCache()
  memory.get('secret', () => 'v1', () => record(room), 'account', room)
  memory.exclude('account', [room])
  memory.get('secret', () => 'v1', () => { loads++; return record(room) }, 'account', room)
  assert.equal(loads, 2)

  const allowed = () => conversationCacheAllowed('account', room)
  const ai = new AiRecordCache()
  assert.equal((await ai.get('key', () => 'v1', async () => 'text', undefined, allowed)).cached, false)
  assert.equal(ai.entries.size, 0)
  const images = new ImageDescriptionCache(join(directory, 'images'))
  const voices = new VoiceTranscriptionCache(join(directory, 'voices'))
  const scope = JSON.stringify(['account', room])
  for (let i = 0; i < 2; i++) {
    assert.equal((await images.getOrDescribe(scope, { data: Buffer.from('image'), mime: 'image/png' }, 'v1', async () => 'image')).fromCache, false)
    assert.equal((await voices.getOrTranscribe(scope, '1234', 'v1', async () => 'voice')).fromCache, false)
  }
  saveExcludedConversations('account', []); excludeDuringBuild = false
  await index.start(source)
  assert.equal(index.messages(room).length, 1, 'removing a group from the list permits indexing again')
  console.log('Cache exclusions passed: validation, account isolation, restart, removal, search, in-flight indexing, report cache cleanup and AI/media cache bypass.')
} finally { index?.close(); rmSync(directory, { recursive: true, force: true }) }
