const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { stripTypeScriptTypes } = require('node:module')
const assert = require('node:assert/strict')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const directory = path.resolve('.cache/default-report-test')
  await fs.mkdir(directory, { recursive: true })
  try {
    for (const [source, target] of [['src/shared/report-topics.ts', 'topics.mjs'], ['src/main/report-model.ts', 'model.mjs'], ['src/shared/report-messages.ts', 'messages.mjs'], ['src/shared/report-templates.ts', 'templates.mjs'], ['src/shared/report-styles.ts', 'styles.mjs']]) await fs.writeFile(path.join(directory, target), stripTypeScriptTypes(await fs.readFile(source, 'utf8')))
    await fs.writeFile(path.join(directory, 'facts.mjs'), stripTypeScriptTypes((await fs.readFile('src/shared/report-facts.ts', 'utf8')).replace("'./report-messages.ts'", "'./messages.mjs'")))
    await fs.writeFile(path.join(directory, 'feed.mjs'), stripTypeScriptTypes(await fs.readFile('src/shared/report-feed.ts', 'utf8')))
    await fs.writeFile(path.join(directory, 'renderer.mjs'), stripTypeScriptTypes((await fs.readFile('src/main/report-renderer.ts', 'utf8')).replace("'./report-model'", "'./model.mjs'").replace("'../shared/report-topics'", "'./topics.mjs'").replace("'../shared/report-feed'", "'./feed.mjs'")))
    const { reportFacts } = await import(pathToFileURL(path.join(directory, 'facts.mjs')).href)
    const { renderReportHtml } = await import(pathToFileURL(path.join(directory, 'renderer.mjs')).href)
    const { defaultReportTemplates } = await import(pathToFileURL(path.join(directory, 'templates.mjs')).href)
    const { defaultReportStyles } = await import(pathToFileURL(path.join(directory, 'styles.mjs')).href)
    assert.equal(defaultReportTemplates[0].name, '默认')
    assert.equal(defaultReportStyles[0].name, '默认')
    assert.ok(defaultReportStyles[0].prompt.includes('40–80字'))
    const start = new Date(2026, 9, 30, 8, 12, 5).getTime()
    const end = new Date(2026, 9, 30, 23, 48, 16).getTime()
    const names = ['林言', '陈晨', '周舟', '许安', '苏禾', '顾宁']
    const messages = names.flatMap((name, member) => Array.from({ length: 7 - member }, (_, index) => ({ id: `${member}-${index}`, from: 'them', senderId: `member-${member}`, sender: name, messageType: 1, createdAt: index === 0 ? start : end, text: '示例发言', time: '08:12' })))
    const facts = reportFacts(messages)
    assert.equal(facts.participantCount, 6)
    assert.equal(facts.participants.length, 5)
    assert.deepEqual(facts.participants.map(member => member.count), [7, 6, 5, 4, 3])
    assert.equal(facts.firstAt, start)
    assert.equal(facts.lastAt, end)
    const content = `## 概要
今天围绕产品体验、发布安排和用户反馈展开讨论，明确了本周交付顺序，并整理出需要继续验证的问题与下一步行动。
## 今日讨论热点
### 首页信息层级：先让用户找到重点
大家围绕首页内容过多的问题展开讨论，建议将核心信息提前，减少重复入口。林言提出先保留三项高频操作，团队同意用新版草图继续验证。
> “打开后先看到今天最重要的事，再决定往哪里走。”——林言，09:24 [12]
- 已确认：保留核心入口，次要操作收进更多菜单。
- 待确认：新布局是否能缩短首次使用的理解时间。
### 本周发布计划与验证范围
陈晨更新了当前进度，周舟补充了验收要求。本轮优先完成主流程，边缘场景继续收集反馈。
- 周五前完成主要问题修复与回归检查。
- 发布前核对移动端阅读、报告导出与异常提示。
### 用户反馈：等待过程需要更清楚
多位成员提到等待时缺少明确提示。讨论形成的共识是：展示正在做什么、处理数量和失败原因，避免用户反复点击。
## 重要发言
### 林言 · 09:24
“先让用户看到最重要的内容。”[12]
### 陈晨 · 14:36
“这周先保证主流程稳定，再逐步补齐细节。”[18]
## 原文摘录
> 林言 · 09:24 [12]：打开后先看到今天最重要的事，再决定往哪里走。
> 许安 · 16:08 [23]：如果没有数据，就把原因直接告诉用户。
## 问题与解答
### 报告失败后，语音需要重新识别吗？
记录中的答复是：已成功识别的结果保存在本地，重试时复用，不重复转写。[26]
## 待跟进事项
- **移动端报告检查**：周舟负责，周五前确认长图内容与文字可读性。[18]
- **首页方案验证**：林言继续整理草图；完成时间未提及。[12]
- **等待提示补充**：需要明确展示进度与失败原因；负责人待确认。[23]
## 关键词
产品体验 · 阅读层级 · 发布安排 · 用户反馈 · 本地缓存`
    const document = { ...facts, template: defaultReportTemplates[0], name: '产品交流小组', startDate: '2026-10-30', endDate: '2026-10-30', messageCount: messages.length, counts: { message: messages.length, voice: 0, image: 0, video: 0 }, content, warnings: [], width: 430 }
    const html = renderReportHtml(document)
    assert.ok(html.includes('产品交流小组 日报'))
    assert.ok(html.includes('08:12:05 — 23:48:16'))
    assert.equal((html.match(/class="participant"/g) || []).length, 5)
    assert.ok(html.includes('class="daily-summary"'))
    assert.ok(html.includes('MESSAGES'))
    assert.ok(html.includes('PARTICIPANTS'))
    assert.ok(!html.includes('<i>1</i>'))
    assert.equal((html.match(/class="topic-card"/g) || []).length, 3)
    assert.ok(html.includes('class="topic-member"'))
    assert.ok(!html.includes('[12]'))
    assert.ok(!html.includes('<h2>概要</h2>'), '概要只在顶部展示一次')
    assert.ok(html.includes('<h3>首页信息层级：先让用户找到重点</h3>'))
    const crossDay = renderReportHtml({ ...document, lastAt: end + 86400000 })
    assert.ok(crossDay.includes('2026-10-30 08:12:05 — 2026-10-31 23:48:16'))
    const unsafe = renderReportHtml({ ...document, participants: [{ key: 'bad', name: '<script>', count: 1, avatar: 'javascript:alert(1)' }] })
    assert.ok(!unsafe.includes('src="javascript:'))
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII='
    assert.ok(renderReportHtml({ ...document, participants: [{ key: 'local', name: '头像', count: 1, avatar: pixel }] }).includes(`<img src="${pixel}"`))
    await fs.mkdir('.screenshots', { recursive: true })
    const htmlPath = path.resolve('.screenshots/default-report-preview.html')
    await fs.writeFile(htmlPath, html)
    const window = new BrowserWindow({ show: false, width: 430, height: 900, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    try {
      await window.loadURL(pathToFileURL(htmlPath).href)
      const height = await window.webContents.executeJavaScript('document.documentElement.scrollHeight')
      window.setContentSize(430, height)
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const frame = await new Promise((resolve, reject) => {
        const listener = (_event, _dirty, image) => { if (image.getSize().height !== height) return; clearTimeout(timer); window.webContents.removeListener('paint', listener); resolve(image) }
        const timer = setTimeout(() => reject(new Error('preview render timeout')), 15000)
        window.webContents.on('paint', listener); window.webContents.invalidate()
      })
      await fs.writeFile('.screenshots/default-report-preview.png', frame.toPNG())
      assert.equal(await window.webContents.executeJavaScript('document.images.length'), 0, '没有本地头像时使用昵称占位，不请求远程图片')
    } finally { window.destroy() }
    console.log('默认日报测试通过：真实时段（含秒/跨日）、概要卡片、前五名排序、头像安全嵌入、分节排版与长图预览。')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
