// Synthetic child process and clock: no native database, Electron or network access.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { stripTypeScriptTypes } = require('node:module')
const { pathToFileURL } = require('node:url')
;(async () => {
  await fs.mkdir('.cache', { recursive: true })
  const directory = await fs.mkdtemp(path.resolve('.cache/report-request-'))
  const children = []
  globalThis.reportRequestFixture = {
    app: { getAppPath: () => '/synthetic', getPath: () => '/synthetic' },
    utilityProcess: { fork: (_file, _args, options) => {
      const child = new EventEmitter()
      child.commands = []
      child.serviceName = options.serviceName
      child.killed = false
      child.kill = () => { child.killed = true }
      child.postMessage = command => child.commands.push(command)
      children.push(child)
      return child
    } },
  }
  const originalTimeout = global.setTimeout, originalClear = global.clearTimeout
  const timers = new Set()
  global.setTimeout = (callback, ms) => { assert.equal(ms, 180_000); timers.add(callback); return callback }
  global.clearTimeout = timer => timers.delete(timer)
  try {
    await fs.writeFile(path.join(directory, 'policy.mjs'), stripTypeScriptTypes(await fs.readFile('src/main/conversation-cache-policy.ts', 'utf8')))
    const policy = await import(pathToFileURL(path.join(directory, 'policy.mjs')).href)
    policy.configureConversationCachePolicy(path.join(directory, 'policy'))
    let source = await fs.readFile('src/main/wechat-background.ts', 'utf8')
    source = source.replace(/import \{ app, utilityProcess, type UtilityProcess \} from 'electron'/, 'const { app, utilityProcess } = globalThis.reportRequestFixture')
      .replace("'./conversation-cache-policy'", "'./policy.mjs'")
      .replace(/import \{ cacheImagePreview, readImagePreview \} from '[^']+'/, 'const cacheImagePreview = () => {}; const readImagePreview = () => undefined')
    await fs.writeFile(path.join(directory, 'background.mjs'), `const __dirname = '/synthetic';\n${stripTypeScriptTypes(source)}`)
    const { runWechatReportQuery, runWechatSync, runWechatChatIndex } = await import(pathToFileURL(path.join(directory, 'background.mjs')).href)
    const account = { root: '/synthetic', wxid: 'synthetic' }
    const first = runWechatReportQuery(account, 'fake', { conversationId: 'first' })
    const second = runWechatReportQuery(account, 'fake', { conversationId: 'second' })
    const child = children[0]
    const commands = child.commands.filter(command => command.type === 'report')
    child.emit('message', { id: commands[1].id, result: 'second-result' })
    assert.equal(await second, 'second-result')
    assert.equal(timers.size, 1, '并发请求独立清理计时器')
    const rejected = assert.rejects(first, /超时/)
    const expire = [...timers][0]
    timers.delete(expire)
    expire()
    await rejected
    child.emit('message', { id: commands[0].id, result: 'late-result' })
    const retry = runWechatReportQuery(account, 'fake', {})
    const retryChild = children.at(-1)
    assert.notEqual(retryChild, child, '超时后必须使用新进程，避免再次排队到卡住的原生调用后面')
    assert.equal(child.killed, true)
    child.emit('exit')
    retryChild.emit('message', { id: retryChild.commands.at(-1).id, error: '模拟读取失败' })
    await assert.rejects(retry, /模拟读取失败/)
    assert.equal(timers.size, 0)
    const exiting = runWechatReportQuery(account, 'fake', {})
    retryChild.emit('exit')
    await assert.rejects(exiting, /进程已退出/)
    assert.equal(timers.size, 0)
    const recovered = runWechatReportQuery(account, 'fake', {})
    const replacement = children.at(-1)
    replacement.emit('message', { id: replacement.commands.at(-1).id, result: 'recovered' })
    assert.equal(await recovered, 'recovered')
    assert.equal(timers.size, 0)
    const sync = runWechatSync(account, 'fake')
    const syncChild = children.at(-1)
    const statusRead = runWechatChatIndex(account, 'fake', 'status')
    const indexChild = children.at(-1)
    const excluded = await runWechatChatIndex(account, 'fake', 'exclusions', ['secret@chatroom'])
    assert.deepEqual(excluded.excludedConversationIds, ['secret@chatroom'], '索引进程不响应时排除仍能返回')
    assert.deepEqual(policy.excludedConversations(account.root), ['secret@chatroom'], '返回成功前已持久保存名单')
    const maintenance = children.at(-1)
    assert.equal(maintenance, indexChild, '索引导入和排除清理必须共用唯一写进程')
    assert.notEqual(maintenance, syncChild)
    assert.equal(maintenance.commands.at(-1).type, 'apply-exclusions')
    await runWechatChatIndex(account, 'fake', 'exclusions', ['public@chatroom', 'secret@chatroom'])
    assert.equal(maintenance.commands.at(-1).excludedConversationIds, undefined, '后台清理只读取最新名单，不重放旧名单')
    indexChild.emit('message', { id: indexChild.commands.find(command => command.type === 'chat-index').id, result: { state: 'building', messages: 1, conversations: 1, completedStores: 0, totalStores: 1, current: '', updatedAt: null, errors: [], excludedConversationIds: [] } })
    assert.deepEqual((await statusRead).excludedConversationIds, ['public@chatroom', 'secret@chatroom'], '旧状态不能覆盖新排除名单')
    const reportWhileBusy = runWechatReportQuery(account, 'fake', {})
    assert.equal(replacement.commands.at(-1).type, 'report', '报告不会排队到聊天同步或索引任务后面')
    replacement.emit('message', { id: replacement.commands.at(-1).id, result: 'available' })
    assert.equal(await reportWhileBusy, 'available')
    await assert.rejects(runWechatChatIndex(account, 'fake', 'exclusions', ['invalid']), /无效/)
    assert.equal(policy.excludedConversations(account.root).length, 2)
    for (const command of maintenance.commands.filter(command => command.type === 'apply-exclusions')) maintenance.emit('message', { id: command.id })
    await runWechatChatIndex(account, 'fake', 'exclusions', [])
    assert.deepEqual(policy.excludedConversations(account.root), [])
    maintenance.emit('message', { id: maintenance.commands.at(-1).id })
    syncChild.emit('message', { id: syncChild.commands.at(-1).id, result: {} })
    await sync
    assert.equal(timers.size, 0)
    console.log('报告及排除请求测试通过：进程隔离、超时重启、迟到响应、失败重试、索引阻塞时保存排除、旧状态保护及取消排除。')
  } finally {
    global.setTimeout = originalTimeout; global.clearTimeout = originalClear
    delete globalThis.reportRequestFixture
    await fs.rm(directory, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
