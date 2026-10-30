const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const preload = path.resolve('.cache/report-ui-preload.cjs')
  await fs.writeFile(preload, `
const { contextBridge } = require('electron')
const account = { id: 'test', wxid: 'test', root: '/test', nickname: '测试账号' }
const data = { account, conversations: [{ id: 'test@chatroom', name: '产品讨论群', type: 'group', time: '12:00', preview: '讨论项目进度', records: '3', range: '', day: '', messages: [{ id: '1', createdAt: Date.now(), messageType: 1, from: 'them', senderId: 'alice', sender: '成员甲', text: '讨论项目进度', time: '12:00' }] }], messageTotal: 3, syncedAt: new Date().toISOString() }
const voice = { state: 'ready', progress: 1, totalBytes: 239549735, supported: true, directory: '/test', platform: 'darwin', architecture: 'arm64' }
let loads = 0
let oldQueries = 0
let selectionQuery
let revealedReport
let generatedSnapshotId
let lastTargetKey
let indexState = 'idle'
let indexActions = []
let failNextReport = false
let listener = () => {}
let styles = [{ id: 'default', name: '默认', prompt: '先用几十字概括主要话题，再整理讨论重点', builtin: true }, { id: 'concise', name: '简洁摘要', prompt: '聚焦重点', builtin: true }, { id: 'detailed', name: '详尽纪要', prompt: '详细记录', builtin: true }]
data.conversations[0].messages.push({ ...data.conversations[0].messages[0], id: '2', from: 'me', senderId: 'test', sender: '我', text: '我的发言' })
styles.push({ id: 'personal-digest', name: '个人摘要', scope: 'personal', prompt: '总结个人发言', builtin: true })
data.conversations[0].messages.push({ id: 'forward-selection', createdAt: Date.now(), messageType: 49, from: 'them', sender: '转发者', time: '12:00', text: '外层说明', forwarded: { title: '内部聊天', entries: [{ sender: '内部甲', text: '内部第一条' }, { sender: '内部乙', text: '内部第二条' }] } });
data.conversations.push({ ...data.conversations[0], id: 'other@chatroom', name: '另一个讨论群' })
const api = { listReports: async () => [{ id: 'saved-report', name: '已保存的产品讨论群日报', startDate: '2026-10-26', endDate: '2026-10-27', createdAt: 1793345650199, htmlPath: '/test/report.html', pngPaths: ['/test/report.png'] }], revealReport: async file => { revealedReport = file }, getRevealedReport: async () => revealedReport, onAiProgress: () => () => {}, onAiDelta: () => () => {}, getSelectionQuery: async () => selectionQuery, addSelectionFixture: async () => {}, onAiDelta: () => () => {}, getIndexActions: async () => indexActions, controlChatIndex: async query => { indexActions.push(query.action); if (query.action === 'sync' && indexState === 'idle') indexState = 'ready'; if (query.action === 'pause') indexState = 'paused'; if (query.action === 'rebuild' || query.action === 'start') indexState = 'building'; return { ok: true, data: { state: indexState, messages: 3, conversations: 2, completedStores: 1, totalStores: 2, current: 'test@chatroom', updatedAt: null, errors: [] } } }, getReportTargetKey: async () => lastTargetKey, setReportTestFailure: () => { failNextReport = true }, queryConversationSummary: async () => ({ ok: false, error: '模拟会话无统计索引' }), querySpeechStats: async () => ({ ok: false, error: '模拟统计' }), getReportTestStats: async () => ({ loads, oldQueries, generatedSnapshotId }), loadReportConversation: async query => { loads++; selectionQuery = query.selectedMessages; const messages = query.selectedMessages ? query.selectedMessages.map((item, index) => { const parent = data.conversations[0].messages.find(message => message.id === item.id); return item.entryIndex === undefined ? parent : { ...parent, id: 'inner-' + index, senderId: undefined, sender: parent.forwarded.entries[item.entryIndex].sender, text: parent.forwarded.entries[item.entryIndex].text, forwarded: undefined, messageType: 1 }; }) : data.conversations[0].messages; return { ok: true, data: { snapshotId: 'snapshot-' + loads, conversationId: query.conversationId, messages } } }, listReportStyles: async () => styles, saveReportStyle: async input => { const style = { ...input, id: input.id || 'custom-ui-test', builtin: false }; styles = [...styles.filter(item => item.id !== style.id), style]; return style }, deleteReportStyle: async id => { styles = styles.filter(item => item.id !== id); return styles }, getAppInfo: async () => ({ version: 'test', platform: 'darwin' }), listWechatAccounts: async () => [account], getCacheSize: async () => 0, detectWechat: async () => ({ account, hasKey: true }), getKeyStatus: async () => ({ hasKey: true }), syncWechat: async () => ({ ok: true, data }), watchWechatAccount: async () => {}, unwatchWechatAccount: async () => {}, onDatabaseChanged: () => () => {}, listModelConfigs: async () => ['text', 'image'].map(kind => ({ id: kind, kind, source: 'remote', name: kind === 'text' ? '报告语言模型' : '图片理解模型', isDefault: true })), getVoiceModelStatus: async () => voice, onVoiceModelProgress: () => () => {}, onReportProgress: callback => { listener = callback; return () => {} }, queryReportMessages: async () => { oldQueries++; throw new Error('不应重复查询') }, generateReport: async input => { generatedSnapshotId = input.snapshotId; lastTargetKey = input.targetMember?.key; listener({ requestId: input.requestId, stage: 'voice', percent: 25, detail: '本地离线转写 1/2', media: { voice: { total: 3, processed: 2, succeeded: 1, failed: 1, cached: 1 }, image: { total: 2, processed: 0, succeeded: 0, failed: 0, cached: 0 } } }); await new Promise(resolve => setTimeout(resolve, 1000)); if (failNextReport) { failNextReport = false; listener({ requestId: input.requestId, stage: 'error', percent: 0, detail: '测试生成失败', failedStep: '分段整理第 2 轮：3/4', advice: '缩小日期范围或选择简洁风格', diagnosticPath: '/test/task.jsonl' }); return { ok: false, error: '测试生成失败', advice: '缩小日期范围或选择简洁风格', diagnosticPath: '/test/task.jsonl' } }; listener({ requestId: input.requestId, stage: 'done', percent: 100, detail: '报告已生成', media: { voice: { total: 3, processed: 3, succeeded: 2, failed: 1, cached: 1 }, image: { total: 2, processed: 2, succeeded: 1, failed: 1, cached: 0 } } }); return { ok: true, data: { htmlPath: '/test/report.html', pngPaths: ['/test/report.png'], warnings: [], content: '报告' } } }, openReport: async () => {} }
contextBridge.exposeInMainWorld('wetrace', api)
`)
  const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { preload, sandbox: false, offscreen: true, partition: 'report-ui-test' } })
  window.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message) })
  try {
    await window.loadFile(path.resolve('out/renderer/index.html'))
    const run = async script => { try { return await window.webContents.executeJavaScript(script) } catch (error) { throw new Error(`${script}: ${error.message}`) } }
    const until = async script => { for (let i = 0; i < 50; i++) { if (await run(script)) return; await new Promise(resolve => setTimeout(resolve, 100)) }; throw new Error('UI timeout: ' + script + '\n' + await run('document.body.innerText')) }
    await until(`!!document.querySelector('[aria-label="总结"]')`)
    await run(`document.querySelector('[aria-label="总结"]').click()`)
    await until(`!!document.querySelector('.summary-action')`)
    await run(`document.querySelectorAll('.summary-action')[1].click()`)
    await until(`Array.from(document.querySelectorAll('button')).some(button => button.textContent.includes('查看示例'))`)
    assert.equal(await run(`document.querySelectorAll('.template-list-item').length`), 1)
    await run(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('查看示例')).click()`)
    await until(`!!document.querySelector('iframe[title="默认模板报告示例"]')`)
    let example
    for (let attempt = 0; attempt < 50; attempt++) {
      example = window.webContents.mainFrame.frames.find(frame => frame.url.endsWith('default-report-example.html'))
      if (example) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(example, '打包后的示例页面可打开')
    assert.ok((await fs.readFile(path.resolve('out/renderer/default-report-example.html'), 'utf8')).includes('template-mobile-feed'))
    await run(`document.querySelector('.page-back').click()`)
    await until(`!!document.querySelector('.template-list')`)
    await run(`document.querySelector('.page-back').click()`)
    await until(`!!document.querySelector('.summary-action')`)
    await run(`document.querySelector('.summary-action').click()`)
    await until(`!!document.querySelector('.report-progress-panel') && document.querySelector('.report-count').textContent.includes('条')`)
    assert.deepEqual(await run(`window.wetrace.getReportTestStats()`), { loads: 1, oldQueries: 0, generatedSnapshotId: undefined })
    for (let index = 0; index < 4; index++) {
      await run(`document.querySelectorAll('.report-check input')[${index}].click()`)
      await run(`document.querySelectorAll('.report-check input')[${index}].click()`)
    }
    for (const text of ['今天', '昨天', '近 7 天']) {
      await run(`Array.from(document.querySelectorAll('.report-date-presets button')).find(button => button.textContent === ${JSON.stringify(text)}).click()`)
    }
    assert.equal((await run(`window.wetrace.getReportTestStats()`)).loads, 1)
    await run(`document.querySelectorAll('.report-layout .conv')[1].click()`)
    await until(`document.querySelector('.report-selected').textContent.includes('另一个讨论群') && document.querySelector('.report-count').textContent.includes('条')`)
    await run(`document.querySelectorAll('.report-layout .conv')[0].click()`)
    await until(`document.querySelector('.report-selected').textContent.includes('产品讨论群') && document.querySelector('.report-count').textContent.includes('条')`)
    assert.equal((await run(`window.wetrace.getReportTestStats()`)).loads, 3)
    await run(`document.querySelector('.report-list-title button').click()`)
    await until(`!!document.querySelector('.summary-action')`)
    await run(`document.querySelector('.summary-action').click()`)
    await until(`!!document.querySelector('.report-progress-panel') && document.querySelector('.report-count').textContent.includes('条')`)
    assert.equal((await run(`window.wetrace.getReportTestStats()`)).loads, 3)
    assert.equal(await run(`document.documentElement.scrollWidth <= innerWidth`), true)
    assert.equal(await run(`document.querySelector('[aria-label="图片理解模型"]').value`), '')
    await run(`(() => { const select = document.querySelector('[aria-label="图片理解模型"]'); select.value = 'image'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    assert.equal(await run(`document.querySelectorAll('input[name="report-style"]').length`), 0)
    await run(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === '新建风格').click()`)
    await until(`!!document.querySelector('[aria-label="自定义风格名称"]')`)
    await run(`(() => { const set = (label, value, proto) => { const input = document.querySelector('[aria-label="' + label + '"]'); Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }; set('自定义风格名称', '项目风格', HTMLInputElement.prototype); set('自定义风格要求', '优先整理风险及责任人', HTMLTextAreaElement.prototype); })()`)
    await run(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === '保存风格').click()`)
    await until(`document.querySelector('[aria-label="报告风格"]').value === 'custom-ui-test'`)
    await run(`(() => { const select = document.querySelector('[aria-label="报告模板"]'); select.value = 'default'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    assert.equal(await run(`document.querySelector('[aria-label="报告风格"]').value`), 'custom-ui-test')
    window.setContentSize(1000, 900)
    await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
    assert.equal(await run(`document.querySelector('.report-progress-panel').getBoundingClientRect().right <= innerWidth`), true)
    window.setContentSize(1280, 900)
    await run(`document.querySelector('.report-submit button').click()`)
    await until(`document.querySelector('.report-progress-panel').textContent.includes('本地离线转写')`)
    assert.equal(await run(`document.querySelector('.report-submit button').disabled`), true)
    assert.ok((await run(`document.querySelector('[aria-label="当前报告任务"]').textContent`)).includes('产品讨论群'))
    await run(`document.querySelectorAll('.report-layout .conv')[1].click()`)
    await until(`document.querySelector('.report-selected').textContent.includes('另一个讨论群')`)
    assert.ok((await run(`document.querySelector('.report-task-identity').textContent`)).includes('产品讨论群'), '切换会话后任务身份固定')
    assert.ok((await run(`document.querySelector('.report-task-scope-note').textContent`)).includes('产品讨论群'))

    await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
    await fs.mkdir('.screenshots', { recursive: true })
    await fs.writeFile('.screenshots/report-progress-test.png', (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
    await until(`!!document.querySelector('.report-output')`)
    assert.ok((await run(`document.querySelector('[aria-label="语音识别统计"]').textContent`)).includes('3/3'))
    assert.equal(await run(`document.querySelector('[aria-label="语音识别统计"] .success b').textContent`), '2')
    assert.equal(await run(`document.querySelector('[aria-label="图片理解统计"] .failure b').textContent`), '1')
    assert.equal(await run(`document.querySelector('.report-submit button').disabled`), false)
    assert.ok((await run(`document.querySelector('.report-task-identity').textContent`)).includes('产品讨论群'), '完成结果仍属于原任务')
    await run(`document.querySelectorAll('.report-layout .conv')[0].click()`)
    await until(`document.querySelector('.report-selected').textContent.includes('产品讨论群') && document.querySelector('.report-count').textContent.includes('条')`)

    await run(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === '删除风格').click()`)
    await until(`document.querySelector('[aria-label="报告风格"]').value === 'default'`)
    assert.equal(await run(`!!document.querySelector('[aria-label="报告风格"] option[value="custom-ui-test"]')`), false)
    assert.deepEqual(await run(`window.wetrace.getReportTestStats()`), { loads: 5, oldQueries: 0, generatedSnapshotId: 'snapshot-3' })
    for (const key of ['id:alice', 'self']) {
      await run(`(() => { const select = document.querySelector('[aria-label="总结对象"]'); select.value = ${JSON.stringify(key)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
      await run(`document.querySelector('.report-submit button').click()`)
      await until(`document.querySelector('.report-submit button').disabled`)
      await until(`!document.querySelector('.report-submit button').disabled && !!document.querySelector('.report-output')`)
      assert.equal(await run(`window.wetrace.getReportTargetKey()`), key)
    }
    await run(`(() => { const select = document.querySelector('[aria-label="总结对象"]'); select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    await run(`window.wetrace.setReportTestFailure()`)
    await run(`document.querySelector('.report-submit button').click()`)
    await until(`!!document.querySelector('.report-progress-error')`)
    const failure = await run(`document.querySelector('.report-progress-error').textContent`)
    assert.ok(failure.includes('测试生成失败') && failure.includes('分段整理第 2 轮：3/4') && failure.includes('简洁风格') && failure.includes('任务编号'))
    assert.equal(await run(`document.querySelector('.report-progress-error button').textContent`), '打开诊断日志')
    assert.equal(await run(`document.querySelector('[aria-label="语音识别统计"] .failure b').textContent`), '1')
    assert.ok((await run(`document.querySelector('[aria-label="语音识别统计"]').textContent`)).includes('2/3'))
    await run(`document.querySelector('[aria-label="设置"]').click()`)
    await until(`!!document.querySelector('[aria-label="全部聊天记录索引"]')`)
    assert.ok((await run(`document.querySelector('[aria-label="全部聊天记录索引"]').textContent`)).includes('3 条消息'))
    await run(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === '更新索引').click()`)
    await until(`Array.from(document.querySelectorAll('button')).some(button => button.textContent === '暂停建立' && !button.disabled)`)
    await run(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === '暂停建立').click()`)
    await until(`Array.from(document.querySelectorAll('button')).some(button => button.textContent === '继续建立' && !button.disabled)`)
    await run(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === '继续建立').click()`)
    await until(`Array.from(document.querySelectorAll('button')).some(button => button.textContent === '暂停建立' && !button.disabled)`)
    const indexActions = await run(`window.wetrace.getIndexActions()`)
    for (const action of ['sync', 'pause', 'start']) assert.ok(indexActions.includes(action))
    await run(`window.wetrace.addSelectionFixture()`)
    await run(`document.querySelector('[aria-label="消息"]').click()`)
    await until(`!!document.querySelector('.chat-head')`)
    await run(`Array.from(document.querySelectorAll('.conv')).find(button => button.textContent.includes('产品讨论群')).click()`)
    await until(`!!document.querySelector('.message-forwarded')`)
    await run(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === '选择消息生成报告').click()`)
    await until(`!!document.querySelector('.report-message-picker')`)
    const beforeSelection = await run(`window.wetrace.getReportTestStats()`)
    await run(`document.querySelector('[aria-label="选择第 1 条消息"]').click()`)
    await run(`document.querySelector('.report-pick-forwarded').open = true`)
    await run(`document.querySelector('[aria-label="选择第 3 条消息中的第 2 条转发消息"]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`)
    assert.ok((await run(`document.querySelector('.report-selection-bar').textContent`)).includes('已选 4 条'), 'Shift 跨普通消息和转发内部消息连续选择')
    await run(`Array.from(document.querySelectorAll('.report-picker-actions button')).find(button => button.textContent === '清空选择').click()`)

    await run(`document.querySelector('[aria-label="选择第 1 条消息"]').click()`)
    await run(`document.querySelector('[aria-label="选择第 2 条消息"]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`)
    assert.ok((await run(`document.querySelector('.report-selection-bar').textContent`)).includes('已选 2 条'))
    await run(`document.querySelector('.report-pick-forwarded').open = true`)
    await run(`document.querySelector('[aria-label="选择第 3 条消息中的第 1 条转发消息"]').click()`)
    assert.ok((await run(`document.querySelector('.report-selection-bar').textContent`)).includes('已选 3 条'))
    assert.equal((await run(`window.wetrace.getReportTestStats()`)).loads, beforeSelection.loads, '勾选操作不拉取数据')
    if (process.env.REPORT_SELECTION_PREVIEW) { await fs.mkdir('.screenshots', { recursive: true }); await fs.writeFile('.screenshots/report-message-picker.png', (await window.webContents.capturePage()).toPNG()) }
    await run(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === '生成所选消息报告').click()`)
    await until(`!!document.querySelector('.report-selected-scope') && document.querySelector('.report-count').textContent.includes('条')`)
    if (process.env.REPORT_SELECTION_PREVIEW) await fs.writeFile('.screenshots/report-selected-config.png', (await window.webContents.capturePage()).toPNG())
    assert.equal((await run(`window.wetrace.getSelectionQuery()`)).length, 3)
    assert.equal((await run(`window.wetrace.getSelectionQuery()`)).filter(item => item.entryIndex !== undefined).length, 1)
    assert.ok((await run(`document.querySelector('[aria-label="总结对象"]').textContent`)).includes('内部甲'))
    assert.equal(await run(`document.querySelector('.report-date-presets').hidden`), true)
    const selectionLoads = (await run(`window.wetrace.getReportTestStats()`)).loads
    await run(`document.querySelectorAll('.report-check input')[0].click()`)
    await run(`document.querySelectorAll('.report-check input')[0].click()`)
    assert.equal((await run(`window.wetrace.getReportTestStats()`)).loads, selectionLoads)
    await run(`document.querySelector('.report-submit button').click()`)
    await until(`document.querySelector('.report-submit button').disabled`)
    await until(`!document.querySelector('.report-submit button').disabled && !!document.querySelector('.report-output')`)
    assert.equal((await run(`window.wetrace.getReportTestStats()`)).generatedSnapshotId, 'snapshot-' + selectionLoads)
    await run(`Array.from(document.querySelectorAll('.report-output button')).find(button => button.textContent.includes('打开所在文件夹')).click()`)
    assert.equal(await run(`window.wetrace.getRevealedReport()`), '/test/report.html')
    assert.ok((await run(`document.querySelector('.report-output-path').textContent`)).includes('/test'))
    await run(`Array.from(document.querySelectorAll('.report-output button')).find(button => button.textContent === '查看全部报告').click()`)
    await until(`document.querySelectorAll('.report-history-item').length === 1`)
    assert.ok((await run(`document.querySelector('.report-history-item').textContent`)).includes('已保存的产品讨论群日报'))
    await run(`Array.from(document.querySelectorAll('.report-history-actions button')).find(button => button.textContent.includes('打开文件夹')).click()`)
    assert.equal(await run(`window.wetrace.getRevealedReport()`), '/test/report.html')
    await run(`(() => { const input = document.querySelector('[aria-label="搜索已生成报告"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '不存在的会话'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    await until(`document.querySelectorAll('.report-history-item').length === 0`)


    console.log('报告页面测试通过：语音/图片实时计数与失败后保留、内容/日期/风格/模板配置零额外读取、切换会话刷新、返回页面复用、风格下拉、新建与删除、模板独立选择、右侧进度、重复提交保护、结果入口及宽度布局。')
  } finally { window.destroy(); await fs.rm(preload, { force: true }) }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
