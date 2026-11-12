// Synthetic database fixture: no WeChat data or model service is accessed.
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const { stripTypeScriptTypes } = require('node:module')
const { pathToFileURL } = require('node:url')
const { createHash } = require('node:crypto')
;(async () => {
  const directory = path.resolve('.cache/report-loading-test')
  await fs.mkdir(directory, { recursive: true })
  const counters = { pages: 0, images: 0, voices: 0, avatars: 0 }
  let fingerprint = 'original'
  let fingerprintReads = 0
  let indexReady = true
  let indexedRows = []
  let emptySelection = false
  let contentError
  let indexError
  let rawError
  let pageHook = () => {}
  let realChatIndex
  let useRealIndex = false
  let allowProfiles = false
  const rows = Array.from({ length: 700 }, (_, i) => ({ id: String(i), type: i === 0 ? 3 : i === 1 ? 34 : 1, createTime: 1700000000 + i, content: '测试内容', sender: 'sender', isSend: false, serverId: String(i + 1) }))
  let sourceRows = rows
  const summary = items => items.reduce((result, row) => ({ total: result.total + 1, firstAt: result.firstAt === null ? row.createTime * 1000 : Math.min(result.firstAt, row.createTime * 1000), lastAt: result.lastAt === null ? row.createTime * 1000 : Math.max(result.lastAt, row.createTime * 1000) }), { total: 0, firstAt: null, lastAt: null })
  globalThis.reportLoadingFixture = {
    findSilentMembers: () => [], queryConversationIndexSummary: () => {}, querySpeechIndex: () => {}, sourceFingerprint: () => { fingerprintReads++; return fingerprint },
    ChatIndex: class {
      constructor(...args) { if (useRealIndex) return new realChatIndex(...args) }
      exclude() {}
      close() {}
      hasConversation() { if (indexError) throw indexError; return indexReady }
      reportContent() { if (contentError) throw contentError; return { rows: indexedRows, counts: { message: indexedRows.length, voice: 0, image: 0, video: 0 } } }
      selectedReportMessages() { return indexedRows }
      summary() { return summary(indexedRows.length ? indexedRows : rows) }
      isFresh() { throw new Error('报告选择不应检查整个微信数据目录') }
      reportSelection() { return { revision: 'indexed-version', summary: summary(rows), rows: (emptySelection ? [] : rows).map(row => ({ id: row.id, time: row.createTime * 1000, type: row.type, sender: row.sender, count: 1 })) } }
    },
    Wcdb4Client: class {
      aggregateConversation() { return summary(sourceRows) }
      getMessages(room, limit, offset) { counters.pages++; pageHook(); if (rawError) throw rawError; return sourceRows.slice().sort((a, b) => b.createTime - a.createTime).slice(offset, offset + limit).reverse() }
      getDisplayNames() { return new Map([['sender', '群成员']]) }
      getGroupNicknames() { return new Map() }
      getProfiles(ids) { counters.avatars++; if (!allowProfiles) throw new Error('报告选择不应读取头像'); return new Map(ids.map(id => [id, { nickname: '测试昵称', avatar: 'data:image/png;base64,synthetic-avatar' }])) }
      getVoiceData() { counters.voices++; return { hex: '1234' } }
    },
    localImages: () => { counters.images++; return new Map() },
    presentMessage: (type, text) => type === 3 ? { text: '[图片]', image: { source: 'wetrace-media://preview/test' } } : { text },
  }
  try {
    let source = await fs.readFile('src/main/wechat-records.ts', 'utf8')
    const modules = { 'src/main/image-preview-cache.ts': 'preview.mjs', 'src/main/recall-capture-window.ts': 'capture-window.mjs', 'src/main/chat-recall-capture.ts': 'recall.mjs', 'src/shared/retained-recalls.ts': 'retained.mjs', 'src/shared/revoke-message.ts': 'revoke.mjs', 'src/main/group-monitor.ts': 'monitor.mjs', 'src/main/conversation-cache-policy.ts': 'policy.mjs' }
    const rewrite = value => value.replace(/(['"])(\.\.?\/[^'"]+)\1/g, (match, quote, specifier) => {
      const base = specifier.replace(/\.ts$/, '')
      const target = Object.entries(modules).find(([file]) => file.replace(/\.ts$/, '').endsWith(base.replace(/^\.\.?\//, '')))
      return target ? `${quote}./${target[1]}${quote}` : match
    })
    source = rewrite(source)
    for (const [file, name] of Object.entries(modules)) await fs.writeFile(path.join(directory, name), stripTypeScriptTypes(rewrite(await fs.readFile(file, 'utf8'))))
    const { configureConversationCachePolicy, saveExcludedConversations } = await import(pathToFileURL(path.join(directory, 'policy.mjs')).href)
    configureConversationCachePolicy(path.join(directory, 'policy'))
    source = source.replace("import { ChatIndex } from './chat-index'", 'const { ChatIndex } = globalThis.reportLoadingFixture')
    await fs.writeFile(path.join(directory, 'chat-index-shared.mjs'), stripTypeScriptTypes(await fs.readFile('src/shared/chat-index.ts', 'utf8')))
    await fs.writeFile(path.join(directory, 'chat-index.mjs'), stripTypeScriptTypes((await fs.readFile('src/main/chat-index.ts', 'utf8')).replace("'../shared/chat-index.ts'", "'./chat-index-shared.mjs'")))
    realChatIndex = (await import(pathToFileURL(path.join(directory, 'chat-index.mjs')).href)).ChatIndex
    source = source.replace(/import \{ findSilentMembers \} from '[^']+'/g, 'const { findSilentMembers } = globalThis.reportLoadingFixture')
    source = source.replace(/import \{ sourceFingerprint \} from '[^']+'/, 'const { sourceFingerprint } = globalThis.reportLoadingFixture')
    source = source.replace(/import \{ queryConversationIndexSummary, querySpeechIndex, sourceFingerprint \} from '[^']+'/, 'const { queryConversationIndexSummary, querySpeechIndex, sourceFingerprint } = globalThis.reportLoadingFixture')
    source = source.replace(/import \{ localImages, presentMessage \} from '[^']+'/, 'const { localImages, presentMessage } = globalThis.reportLoadingFixture')
    source = source.replace(/import \{ Wcdb4Client, type WcdbMessage \} from '[^']+'/, 'const { Wcdb4Client } = globalThis.reportLoadingFixture')
    source = source.replace("'./report-disk-index'", "'./disk-index.mjs'")
    await fs.writeFile(path.join(directory, 'disk-index.mjs'), stripTypeScriptTypes(await fs.readFile('src/main/report-disk-index.ts', 'utf8')))
    source = source.replace("'../shared/report-selection'", "'./selection.mjs'")
    await fs.writeFile(path.join(directory, 'selection.mjs'), stripTypeScriptTypes(await fs.readFile('src/shared/report-selection.ts', 'utf8')))
    source = source.replace("'./report-record-cache'", "'./cache.mjs'").replace("'../shared/report-messages'", "'./filter.mjs'")
    await fs.writeFile(path.join(directory, 'records.mjs'), stripTypeScriptTypes(source))
    await fs.writeFile(path.join(directory, 'cache.mjs'), stripTypeScriptTypes(await fs.readFile('src/main/report-record-cache.ts', 'utf8')))
    await fs.writeFile(path.join(directory, 'filter.mjs'), stripTypeScriptTypes(await fs.readFile('src/shared/report-messages.ts', 'utf8')))
    const { queryWechatReportMessages, prepareWechatReportMedia, queryWechatSpeechStats, queryWechatConversationSummary, searchWechatChatIndex, readIndexedConversation } = await import(pathToFileURL(path.join(directory, 'records.mjs')).href)
    const account = { root: '/test', wxid: 'me' }
    const query = { conversationId: 'chat@chatroom', startDate: '1970-01-01', endDate: '9999-12-31', contentTypes: ['message', 'voice', 'image', 'video'], deferMedia: true }
    const start = performance.now()
    const first = queryWechatReportMessages(account, 'key', query)
    assert.equal(first.messages.length, 700)
    assert.deepEqual(counters, { pages: 2, images: 0, voices: 0, avatars: 0 })
    assert.equal(first.messages[0].text, '[图片]')
    assert.equal(first.messages[0].image, undefined)
    assert.equal(first.messages[1].voice, undefined)
    assert.ok(first.messages[0].reportMedia)
    const second = queryWechatReportMessages(account, 'key', query)
    assert.equal(second, first)
    assert.equal(counters.pages, 2, '数据未变化时不重新扫描历史消息')
    fingerprint = 'updated'
    queryWechatReportMessages(account, 'key', query)
    assert.equal(counters.pages, 4, '数据库变化时读取最新记录')
    const voice = prepareWechatReportMedia(account, 'key', query.conversationId, first.messages[1])
    assert.equal(voice.voice.hex, '1234')
    assert.equal(counters.voices, 1)
    prepareWechatReportMedia(account, 'key', query.conversationId, first.messages[0])
    assert.equal(counters.images, 1)
    assert.equal(counters.pages, 4, '准备素材不会重新分页读取会话')
    const beforeMetadata = { pages: counters.pages, fingerprintReads }
    const metadata = queryWechatReportMessages(account, 'key', { ...query, metadataOnly: true }, undefined, '/mock-index')
    assert.equal(metadata.messages.length, 700)
    assert.equal(metadata.indexRevision, 'indexed-version')
    assert.ok(metadata.messages.every(message => message.text === '' && !message.reportMedia && !message.voice))
    assert.equal(counters.pages, beforeMetadata.pages, '索引选择阶段零历史分页读取')
    assert.equal(fingerprintReads, beforeMetadata.fingerprintReads, '其他会话变化不会触发源目录检查或全量回退')
    fingerprint = 'another-conversation-updated'
    queryWechatReportMessages(account, 'key', { ...query, metadataOnly: true }, undefined, '/mock-index')
    assert.equal(counters.pages, beforeMetadata.pages)
    indexReady = false
    const fallback = queryWechatReportMessages(account, 'key', { ...query, metadataOnly: true }, undefined, '/mock-index')
    assert.equal(fallback.messages.length, 700)
    assert.equal(fallback.indexRevision, undefined)
    assert.equal(fallback.messages[2].text, '测试内容', '回退保留原文供报告快照生成使用')
    assert.equal(counters.pages, beforeMetadata.pages + 2)
    indexError = new Error('database is locked')
    assert.equal(queryWechatReportMessages(account, 'key', { ...query, metadataOnly: true }, undefined, '/mock-index').messages.length, 700)
    assert.equal(queryWechatReportMessages(account, 'key', query, undefined, '/mock-index').messages.length, 700)
    indexError = undefined
    rawError = new Error('原始记录读取失败')
    assert.throws(() => queryWechatReportMessages(account, 'key', query, undefined, '/mock-index'), /原始记录读取失败/)
    rawError = undefined
    const originalNow = Date.now
    let now = 0
    Date.now = () => now
    pageHook = () => { now += 120_001 }
    try {
      assert.throws(() => queryWechatReportMessages(account, 'key', query, undefined, '/mock-index'), /原始记录超时/)
    } finally { Date.now = originalNow; pageHook = () => {} }
    assert.equal(queryWechatReportMessages(account, 'key', query, undefined, '/mock-index').messages.length, 700, '失败或超时后可重试')
    indexReady = true
    emptySelection = true
    assert.equal(queryWechatReportMessages(account, 'key', { ...query, metadataOnly: true }, undefined, '/mock-index').messages.length, 700, '空索引也回退原始数据')
    emptySelection = false
    assert.equal(queryWechatReportMessages(account, 'key', query, undefined, '/mock-index').messages.length, 700, '正文索引未命中时回退')
    contentError = new Error('database is locked')
    assert.equal(queryWechatReportMessages(account, 'key', query, undefined, '/mock-index').messages.length, 700)
    contentError = new Error('会话索引已更新，请重新选择会话后生成报告')
    assert.throws(() => queryWechatReportMessages(account, 'key', { ...query, indexRevision: 'old' }, undefined, '/mock-index'), /索引已更新/)
    contentError = undefined
    saveExcludedConversations(account.root, [query.conversationId])
    assert.equal(queryWechatReportMessages(account, 'key', { ...query, metadataOnly: true }, undefined, '/mock-index').messages.length, 700, '排除索引后仍可直接读取原始记录生成报告')
    saveExcludedConversations(account.root, [])
    const today = '2026-11-11', yesterday = '2026-11-10'
    sourceRows = [...rows, ...[yesterday, today].map((day, i) => ({ ...rows[2], id: 'recent-' + i, content: '近期测试消息 ' + i, createTime: new Date(day + 'T12:00:00').getTime() / 1000 }))]
    const stale = queryWechatReportMessages(account, 'key', { ...query, metadataOnly: true }, undefined, '/mock-index')
    assert.equal(stale.indexRevision, undefined, '历史索引有数据但落后于原始记录时仍须回退')
    const { filterReportMessages } = await import(pathToFileURL(path.join(directory, 'filter.mjs')).href)
    for (const day of [today, yesterday]) {
      const recent = filterReportMessages(stale.messages, { ...query, startDate: day, endDate: day })
      assert.equal(recent.messages.length, 1, day + ' 的新增记录可用于报告')
      assert.ok(recent.messages[0].text.startsWith('近期测试消息'))
    }
    const directRecent = queryWechatReportMessages(account, 'key', { ...query, startDate: yesterday, endDate: today }, undefined, '/mock-index')
    assert.equal(directRecent.messages.length, 2, '正文查询也不能沿用过期索引')
    sourceRows = [...rows.slice(0, -1), { ...rows.at(-1), createTime: new Date(today + 'T12:00:00').getTime() / 1000 }]
    assert.equal(filterReportMessages(queryWechatReportMessages(account, 'key', { ...query, metadataOnly: true }, undefined, '/mock-index').messages, { ...query, startDate: today, endDate: today }).messages.length, 1, '条数相同但最新时间变化也判定为过期')
    sourceRows = rows
    indexedRows = Array.from({ length: 180000 }, (_, i) => ({ ...rows[2], id: String(i), createTime: 1700000000 + i }))
    sourceRows = indexedRows
    const fullHistory = queryWechatReportMessages(account, 'key', query, undefined, '/mock-index')
    assert.equal(fullHistory.messages.length, 180000, '全部历史查询不会因展开大数组导致调用栈溢出')
    assert.equal(fullHistory.messages[0].id, '0')
    assert.equal(fullHistory.messages.at(-1).id, '179999')
    assert.equal(fullHistory.counts.message, 180000)
    const { ReportRecordCache } = await import(pathToFileURL(path.join(directory, 'cache.mjs')).href)
    const smallCache = new ReportRecordCache(100)
    let reads = 0
    for (let i = 0; i < 2; i++) smallCache.get('too-large', () => 'same', () => { reads++; return first })
    assert.equal(reads, 2, '超出容量时不保留大对象')
    const changingCache = new ReportRecordCache()
    let version = 0
    for (let i = 0; i < 2; i++) changingCache.get('changing', () => String(version), () => { reads++; version++; return first })
    assert.equal(reads, 4, '读取期间变化的数据不会作为有效缓存')
    const lockDirectory = path.join(directory, 'locked-index')
    const writer = new realChatIndex(lockDirectory, account.root, 'key', account.wxid)
    const lockRows = [1, 2].map(id => ({ ...rows[2], id: String(id), type: 1 }))
    sourceRows = lockRows
    const mark = { count: 2, maxId: 2, types: 2, times: lockRows.reduce((sum, row) => sum + row.createTime, 0), lengths: lockRows.reduce((sum, row) => sum + row.content.length, 0) }
    await writer.start({ stores: () => [{ id: 'fixture-store', room: query.conversationId, tableName: 'fixture', dbPath: 'fixture' }], watermark: () => mark, page: () => lockRows, fingerprint: () => createHash('sha256').update(JSON.stringify([fingerprint, []])).digest('hex') })
    useRealIndex = true
    writer.db.exec('BEGIN IMMEDIATE')
    try {
      assert.equal(queryWechatConversationSummary(lockDirectory, account, 'key', query.conversationId).total, 2, '统计读取不争用索引写锁')
      assert.equal(queryWechatSpeechStats(lockDirectory, account, 'key', { conversationId: query.conversationId }).total, 2)
      assert.equal(searchWechatChatIndex(lockDirectory, account, 'key', '测试内容').length, 2)
      allowProfiles = true
      const indexedConversation = readIndexedConversation(lockDirectory, account, 'key', query.conversationId, lockRows[0].createTime * 1000)
      allowProfiles = false
      assert.equal(indexedConversation.messages.length, 2)
      assert.equal(indexedConversation.messages[0].avatar, 'data:image/png;base64,synthetic-avatar', '聊天记录读取可加载发言人头像')
      assert.equal(queryWechatReportMessages(account, 'key', { ...query, metadataOnly: true }, undefined, lockDirectory).counts.message, 2)
      saveExcludedConversations(account.root, [query.conversationId])
      assert.equal(searchWechatChatIndex(lockDirectory, account, 'key', '测试内容').length, 0, '后台尚未清理时也不展示已排除的搜索结果')
    } finally {
      writer.db.exec('ROLLBACK'); writer.close(); useRealIndex = false
      saveExcludedConversations(account.root, [])
    }
    console.log(`报告加载测试通过：700 条分页记录和 18 万条历史记录，选择阶段零图片解密、零语音读取、零头像读取；缓存命中零历史扫描，变化后刷新，素材按需读取（测试耗时 ${Math.round(performance.now() - start)}ms）。`)
  } finally { delete globalThis.reportLoadingFixture; await fs.rm(directory, { recursive: true, force: true }) }
})().catch(error => { console.error(error); process.exitCode = 1 })
