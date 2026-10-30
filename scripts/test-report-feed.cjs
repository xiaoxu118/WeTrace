// Synthetic feed example and visual checks; no chat records or model service are accessed.
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { stripTypeScriptTypes } = require('node:module')
const assert = require('node:assert/strict')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const directory = path.resolve('.cache/feed-test')
  await fs.mkdir(directory, { recursive: true })
  try {
    await fs.writeFile(path.join(directory, 'feed.mjs'), stripTypeScriptTypes(await fs.readFile('src/shared/report-feed.ts', 'utf8')))
    const { parseReportFeed, renderReportFeed } = await import(pathToFileURL(path.join(directory, 'feed.mjs')).href)
    const members = ['林言', '陈晨', '周舟', '许安', '苏禾'].map((name, index) => ({ name, key: `member-${index}`, count: 12 - index }))
    const sourceMessages = [
      { reference: 'r1', sender: '林言', text: '首页先保留三项高频操作，其他入口放进更多菜单。', time: '09:24' },
      { reference: 'r2', sender: '陈晨', text: '同意，周五前完成主流程修复，再统一验收。', time: '09:28' },
      { reference: 'r3', sender: '周舟', text: '移动端长图我来检查，周五前给结果。', time: '14:36' },
      { reference: 'r4', sender: '许安', text: '报告重试时，语音需要重新识别吗？', time: '16:08' },
      { reference: 'r5', sender: '苏禾', text: '已经识别的语音会复用本地缓存，不需要重新识别。', time: '16:10' },
      { reference: 'r6', sender: '林言', text: '新首页是否更容易理解，还需要找用户验证。', time: '17:05' },
    ]
    const messageAuthors = sourceMessages.map(source => ({ reference: source.reference, key: members.find(member => member.name === source.sender).key }))
    const data = {
      overview: '围绕产品体验与发布安排展开讨论。',
      hero: { headline: '首页做减法，发布先保主流程', summary: '团队确认先精简首页入口，再完成主流程修复；移动端长图检查已有负责人，新布局的理解成本仍需用户验证。', keyTakeaway: '首页保留三项高频操作，次要入口收进更多菜单。', pendingNote: '验证新首页是否更容易理解。', statusLine: '模型统计不可直接采用' },
      topics: [
        { title: '首页入口精简，阅读重点提前', timeRange: '09:24–09:28', summary: '林言建议保留三项高频操作，陈晨表示同意。次要入口移入更多菜单，减少首页信息负担。', conclusions: [{ text: '核心入口优先，次要操作收进更多菜单。', sourceMessageIds: ['r1', 'r2'] }], sourceMessageIds: ['r1', 'r2'], keywords: ['首页层级', '操作入口'] },
        { title: '周五前完成主流程与移动端验收', timeRange: '09:28–14:36', summary: '本轮先完成主流程修复，移动端长图由周舟检查，周五前反馈验收结果。', conclusions: [{ text: '周舟负责移动端长图检查。', sourceMessageIds: ['r3'] }], sourceMessageIds: ['r2', 'r3'], keywords: ['发布计划', '移动端'] },
        { title: '报告重试复用语音缓存', timeRange: '16:08–16:10', summary: '许安提出重试时是否重复识别的问题，苏禾说明已识别的语音会复用本地缓存。', sourceMessageIds: ['r4', 'r5'], keywords: ['语音转写', '本地缓存'] },
      ],
      importantMessages: [{ sender: '周舟', time: '14:36', content: '移动端长图由周舟负责检查，周五前给结果。', note: '明确了负责人和时间。', sourceMessageIds: ['r3'] }],
      quotes: [{ messages: [{ sender: '林言', content: sourceMessages[0].text, sourceMessageId: 'r1' }, { sender: '陈晨', content: sourceMessages[1].text, sourceMessageId: 'r2' }], note: '从提出方案到确认执行。', sourceMessageIds: ['r1', 'r2'] }],
      qa: [{ question: '报告重试时，语音需要重新识别吗？', answer: sourceMessages[4].text, answerer: '苏禾', sourceMessageIds: ['r4', 'r5'] }],
      todos: [{ task: '检查移动端长图', owner: '周舟', deadline: '周五前', note: '检查阅读效果并反馈验收结果。', sourceMessageIds: ['r3'] }],
      unresolved: [{ question: '新首页能否降低理解成本？', status: '待跟进', note: '需要继续找用户验证。', sourceMessageIds: ['r6'] }],
      resources: [], storylines: [], reversals: [], participantChains: [], keywords: ['首页层级', '主流程', '移动端', '用户验证', '语音缓存'],
    }
    const document = { name: '产品交流小组', startDate: '2026-10-30', endDate: '2026-10-30', firstAt: new Date(2026, 9, 30, 9, 24).getTime(), lastAt: new Date(2026, 9, 30, 17, 5).getTime(), messageCount: 50, width: 430, members, participants: members, messageAuthors, sourceMessages, warnings: [] }
    const html = renderReportFeed(parseReportFeed(JSON.stringify(data)), document)
    assert.ok(!html.includes('{{'))
    assert.ok(!html.includes('模型统计不可直接采用'))
    assert.throws(() => parseReportFeed('{'), /有效 JSON/)
    assert.throws(() => parseReportFeed('{"topics":[]}'), /缺少摘要/)
    assert.throws(() => parseReportFeed('{"hero":{"summary":"摘要"},"topics":[],"todos":{}}'), /应为列表/)
    const hostile = structuredClone(data)
    hostile.hero.summary = '<script>alert(1)</script>{{TOPIC_CARDS}}'
    hostile.topics.push({ title: '无依据话题必须隐藏', sourceMessageIds: ['r999'] })
    hostile.quotes[0].messages.push({ sender: '林言', content: '伪造引语必须隐藏', sourceMessageId: 'r1' })
    hostile.importantMessages[0].sender = 'wxid_not_a_name'
    members[0].avatar = 'https://example.com/tracker.png'
    const safe = renderReportFeed(hostile, document)
    assert.ok(safe.includes('&lt;script&gt;'))
    assert.ok(!safe.includes('<script>'))
    assert.ok(!safe.includes('无依据话题必须隐藏'))
    assert.ok(!safe.includes('伪造引语必须隐藏'))
    assert.ok(!safe.includes('wxid_not_a_name'))
    assert.ok(!safe.includes('tracker.png'))
    delete members[0].avatar
    await fs.mkdir('.screenshots', { recursive: true })
    const htmlPath = path.resolve('.screenshots/default-report-preview.html')
    await fs.writeFile(htmlPath, html)
    await fs.writeFile('src/renderer/public/default-report-example.html', html)
    members[2].avatar = nativeImage.createFromBitmap(Buffer.alloc(512 * 512 * 4, 255), { width: 512, height: 512 }).toDataURL()
    const photoPath = path.join(directory, 'photo.html')
    await fs.writeFile(photoPath, renderReportFeed(data, document))
    delete members[2].avatar
    const window = new BrowserWindow({ show: false, width: 430, height: 900, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    try {
      await window.loadURL(pathToFileURL(photoPath).href)
      for (const width of [430, 1000]) {
        window.setContentSize(width, 900)
        await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        const layout = await window.webContents.executeJavaScript(`({ width:innerWidth, scroll:document.documentElement.scrollWidth, visibleEmpty:[...document.querySelectorAll('.empty-section')].filter(el=>getComputedStyle(el).display !== 'none').length, columns:getComputedStyle(document.querySelector('.topics-grid')).gridTemplateColumns.split(' ').length })`)
        const avatar = await window.webContents.executeJavaScript(`(() => { const image = document.querySelector('.important-card > img'); const box = image.getBoundingClientRect(); const body = document.querySelector('.important-body').getBoundingClientRect(); return { naturalWidth:image.naturalWidth, width:box.width, height:box.height, bodyWidth:body.width }; })()`)
        assert.equal(avatar.naturalWidth, 512)
        assert.equal(avatar.width, 20)
        assert.equal(avatar.height, 20)
        assert.ok(avatar.bodyWidth > width * .65, '大头像不挤占正文')
        assert.ok(layout.scroll <= layout.width, JSON.stringify(layout))
        assert.equal(layout.visibleEmpty, 0)
        assert.equal(layout.columns, width === 430 ? 1 : 2)
      }
      window.setContentSize(430, 900)
      await window.loadURL(pathToFileURL(htmlPath).href)
      const height = await window.webContents.executeJavaScript('document.documentElement.scrollHeight')
      window.setContentSize(430, height)
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const frame = await window.webContents.capturePage()
      await fs.writeFile('.screenshots/default-report-preview.png', frame.toPNG())
    } finally { window.destroy() }
    console.log('信息流日报通过：JSON 校验、依据过滤、原话校验、安全转义、空栏目、手机/桌面布局与示例。')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
