// Run with: pnpm exec electron scripts/test-report-generation.cjs
// Use synthetic messages and model replies; no user records or remote services.
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { stripTypeScriptTypes } = require('node:module')
const { pathToFileURL } = require('node:url')

app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wetrace-report-test-'))
  const moduleDirectory = path.resolve('.cache/report-generation-test')
  await fs.mkdir(moduleDirectory, { recursive: true })
  const modulePath = path.join(moduleDirectory, 'generator.mjs')
  const cachePath = path.join(moduleDirectory, 'voice-cache.mjs')
  const templatesPath = path.join(moduleDirectory, 'templates.mjs')
  const rendererPath = path.join(moduleDirectory, 'renderer.mjs')
  const storePath = path.join(moduleDirectory, 'store.mjs')
  const stylesPath = path.join(moduleDirectory, 'styles.mjs')
  const helperPath = path.join(moduleDirectory, 'model.mjs')
  try {
    app.setPath('documents', temporary)
    app.setPath('userData', path.join(temporary, 'profile'))
    await fs.writeFile(stylesPath, stripTypeScriptTypes(await fs.readFile('src/shared/report-styles.ts', 'utf8')))
    await fs.writeFile(storePath, stripTypeScriptTypes((await fs.readFile('src/main/report-style-store.ts', 'utf8')).replace("'../shared/report-styles'", "'./styles.mjs'")))
    const store = await import(pathToFileURL(storePath).href)
    assert.equal(store.listReportStyles().length, 9)
    assert.equal(store.resolveReportStyle('personal-concise').scope, 'personal')
    const savedStyle = store.saveReportStyle({ name: '项目周报', prompt: '正式语气，优先总结进展、负责人和风险。' })
    assert.ok(savedStyle.id.startsWith('custom-'))
    assert.equal(store.resolveReportStyle(savedStyle.id).prompt, savedStyle.prompt)
    const reloadedStore = await import(pathToFileURL(storePath).href + '?reload')
    assert.equal(reloadedStore.resolveReportStyle(savedStyle.id).name, '项目周报')
    assert.throws(() => store.saveReportStyle({ name: '项目周报', prompt: '重复' }), /同名/)
    assert.throws(() => store.saveReportStyle({ id: 'concise', name: '修改内置', prompt: '测试' }), /只能编辑/)
    assert.throws(() => store.saveReportStyle({ name: '', prompt: '测试' }), /风格名称/)
    assert.throws(() => store.saveReportStyle({ name: '过长', prompt: 'a'.repeat(3001) }), /内容风格/)
    store.saveReportStyle({ id: savedStyle.id, name: '项目周报修订', prompt: '优先整理风险及责任人' })
    assert.equal(store.resolveReportStyle(savedStyle.id).prompt, '优先整理风险及责任人')
    store.deleteReportStyle(savedStyle.id)
    assert.throws(() => store.resolveReportStyle(savedStyle.id), /已不存在/)
    assert.throws(() => store.deleteReportStyle('concise'), /只能删除/)
    const prompts = []
    const stages = []
    const fixture = [
      { id: '1', messageType: 1, text: '讨论内容'.repeat(12000) },
      { id: '2', messageType: 34, text: '[语音]', voice: { hex: '1234' } },
      { id: '3', messageType: 3, text: '[图片]', image: { source: 'wetrace-media://preview/abc123' } },
      { id: '4', messageType: 43, text: 'VIDEO_CONTENT_MUST_NOT_BE_PARSED' },
      { id: '5', messageType: 3, text: '[图片]', image: { unavailable: '未下载' } },
    ].map(item => ({ createdAt: Date.now(), from: 'them', time: '12:00', ...item }))
    let voiceOnly = false
    let feedResponse = false
    let invalidFeedTimes = 0
    let reportLines = 150
    let failTextTimes = 0
    let failImage = false
    let transcriptionCalls = 0
    let modelInitializations = 0
    globalThis.reportFixture = {
      resolveReportModel: (id, kind) => { assert.ok(id); return { id, kind } },
      loadImagePreview: async () => ({ data: Buffer.from('image'), mime: 'image/png' }),
      createOfflineTranscriber: async () => { modelInitializations++; return async hex => { transcriptionCalls++; assert.equal(hex, '1234'); return '离线识别文本' } },
      callReportModel: async (model, prompt, image, options) => {
        prompts.push({ kind: model.kind, prompt, image, options })
        if (voiceOnly) {
          assert.equal(model.kind, 'text')
          assert.ok(prompt.includes('[语音转写] 离线识别文本'), '总结模型必须收到转写后的正文')
          return JSON.stringify({ hero: { summary: '语音内容：离线识别文本。' }, topics: [{ title: '语音讨论', summary: '离线识别文本', sourceMessageIds: ['r1'] }], quotes: [{ messages: [{ sender: '语音成员', content: '离线识别文本', sourceMessageId: 'r1' }], sourceMessageIds: ['r1'] }], todos: [], unresolved: [] })
        }

        if (!image && failTextTimes-- > 0) throw new Error('模型输出达到长度限制，请缩小日期范围或选择简洁风格后重试')
        if (failImage && image) throw new Error('图片模型不可用')
        if (!image && prompt.includes('你正在补全长记录日报')) {
          const reference = /\[(r\d+)\]/.exec(prompt)[1]
          return JSON.stringify({ summary: '参与者围绕具体方案提出不同意见，比较实施顺序，并讨论处理过程与验证结果；记录中尚无明确负责人和截止时间。'.repeat(4), sourceMessageIds: [reference], conclusions: [] })
        }
        if (!image && (feedResponse || (prompt.includes('JSON.parse 解析') && prompt.includes('请生成最终报告')))) {
          if (invalidFeedTimes-- > 0) return '不是有效 JSON'
          return JSON.stringify({ hero: { summary: '成员确认了下一步行动。' }, topics: [{ title: '确认下一步', summary: '围绕进度进行讨论。', sourceMessageIds: ['r1'] }], todos: [], unresolved: [] })
        }
        return image ? '图片中有项目进度表' : '## 整体概览\n本周完成了任务。\n## 原文依据\n消息 [1]\n' + '报告正文\n'.repeat(reportLines)
      },
      resolveReportStyle: id => ['sharp', 'sarcastic'].includes(id) ? store.resolveReportStyle(id) : ({ id, name: id === 'custom-test' ? '项目风格' : '简洁摘要', prompt: id === 'custom-test' ? '优先整理风险及责任人' : '聚焦重点与结论' }),
    }
    const memberHelperPath = path.join(moduleDirectory, 'report-members.mjs')
    await fs.writeFile(memberHelperPath, stripTypeScriptTypes(await fs.readFile('src/shared/report-messages.ts', 'utf8')))
    const factsPath = path.join(moduleDirectory, 'report-facts.mjs')
    await fs.writeFile(factsPath, stripTypeScriptTypes((await fs.readFile('src/shared/report-facts.ts', 'utf8')).replace("'./report-messages.ts'", "'./report-members.mjs'")))
    const topicsPath = path.join(moduleDirectory, 'topics.mjs')
    await fs.writeFile(topicsPath, stripTypeScriptTypes(await fs.readFile('src/shared/report-topics.ts', 'utf8')))
    let source = await fs.readFile('src/main/report-generator.ts', 'utf8')
    await fs.writeFile(path.join(moduleDirectory, 'concurrency.mjs'), stripTypeScriptTypes(await fs.readFile('src/shared/report-concurrency.ts', 'utf8')))
    source = source.replace("'../shared/report-concurrency'", "'./concurrency.mjs'")
    source = source.replace("'../shared/report-topics'", "'./topics.mjs'")
    source = source.replace("'../shared/report-facts'", "'./report-facts.mjs'")
    source = source.replace("'../shared/report-messages'", "'./report-members.mjs'")
    source = source.replace("import { VoiceModelManager } from './voice-model-manager'", '')
    const mocks = ['resolveReportModel', 'loadImagePreview', 'createOfflineTranscriber', 'resolveReportStyle']
    for (const name of mocks) source = source.replace(new RegExp(`import \\{ ${name} \\} from '[^']+'`), `const { ${name} } = globalThis.reportFixture`)
    source = source.replace("import { callReportModel, splitReportText } from './report-model'", "import { splitReportText } from './model.mjs'\nconst { callReportModel } = globalThis.reportFixture")
    await fs.writeFile(templatesPath, stripTypeScriptTypes(await fs.readFile('src/shared/report-templates.ts', 'utf8')))
    source = source.replace("'../shared/report-templates'", "'./templates.mjs'").replace("'../shared/report-feed'", "'./feed.mjs'")
    await fs.writeFile(path.join(moduleDirectory, 'policy.mjs'), stripTypeScriptTypes(await fs.readFile('src/main/conversation-cache-policy.ts', 'utf8')))
    const { configureConversationCachePolicy } = await import(pathToFileURL(path.join(moduleDirectory, 'policy.mjs')).href)
    configureConversationCachePolicy(path.join(temporary, 'cache-policy'))
    await fs.writeFile(cachePath, stripTypeScriptTypes((await fs.readFile('src/main/voice-transcription-cache.ts', 'utf8')).replace("'./conversation-cache-policy.ts'", "'./policy.mjs'")))
    source = source.replace("'./voice-transcription-cache'", "'./voice-cache.mjs'")
    await fs.writeFile(path.join(moduleDirectory, 'image-cache.mjs'), stripTypeScriptTypes((await fs.readFile('src/main/image-description-cache.ts', 'utf8')).replace("'./conversation-cache-policy.ts'", "'./policy.mjs'")))
    source = source.replace("'./image-description-cache'", "'./image-cache.mjs'")
    source = source.replace("'./report-renderer'", "'./renderer.mjs'")
    await fs.writeFile(path.join(moduleDirectory, 'feed.mjs'), stripTypeScriptTypes(await fs.readFile('src/shared/report-feed.ts', 'utf8')))
    await fs.writeFile(rendererPath, stripTypeScriptTypes((await fs.readFile('src/main/report-renderer.ts', 'utf8')).replace("'./report-model'", "'./model.mjs'").replace("'../shared/report-topics'", "'./topics.mjs'").replace("'../shared/report-feed'", "'./feed.mjs'")))
    await fs.writeFile(helperPath, stripTypeScriptTypes(await fs.readFile('src/main/report-model.ts', 'utf8')))
    await fs.writeFile(modulePath, stripTypeScriptTypes(source))
    const { generateReport } = await import(pathToFileURL(modulePath).href)
    const input = { conversationId: 'test@chatroom', requestId: 'test', snapshotId: 'test-snapshot', conversationName: '<script>test</script>', modelId: 'text', imageModelId: 'image', templateId: 'default', style: 'concise', format: 'desktop', contentTypes: ['message', 'voice', 'image', 'video'], startDate: '2026-10-01', endDate: '2026-10-02' }
    const snapshotData = { ...input, messages: fixture, counts: { message: 1, voice: 1, image: 2, video: 1 } }
    const voice = { directory: temporary, cacheVersion: 'test-model-v1', getStatus: async () => ({ state: 'ready' }) }
    await assert.rejects(generateReport({ ...input, targetMember: { key: 'id:missing', name: '不存在的成员' } }, voice, () => {}, snapshotData), /所选成员在当前范围没有消息/)
    failImage = true
    const failedStages = []
    await assert.rejects(generateReport(input, voice, event => failedStages.push(event), snapshotData), /图片模型不可用/)
    assert.deepEqual(failedStages.at(-1).media.image, { total: 2, processed: 2, succeeded: 0, failed: 2, cached: 0 })
    assert.equal(transcriptionCalls, 1)
    assert.equal((await fs.readdir(path.join(app.getPath('userData'), 'cache', 'voice-transcriptions'))).length, 1, '报告失败前已保存成功的语音转写')
    failImage = false
    fixture[0].senderId = 'member-a'
    fixture[0].sender = '成员甲'
    input.targetMember = { key: 'id:member-a', name: '成员甲' }
    prompts.length = 0
    const { generateReport: retryGenerateReport } = await import(pathToFileURL(modulePath).href + '?restart')
    const preparedTypes = []
    const result = await retryGenerateReport(input, voice, event => stages.push(event), snapshotData, async message => { preparedTypes.push(message.messageType); return message })
    assert.ok(prompts.filter(item => !item.image).every(item => item.prompt.includes('本报告仅总结指定成员') && item.prompt.includes('成员甲')))
    assert.ok(prompts.some(item => item.prompt.includes('[总结对象本人]成员甲')))
    assert.deepEqual(preparedTypes, [34, 3, 3], '仅准备本次选中的语音与图片，文本和视频不处理素材')
    assert.equal(transcriptionCalls, 1, '重新生成从磁盘复用转写结果')
    assert.equal(modelInitializations, 1, '缓存命中时不初始化离线模型')
    assert.ok(stages.some(item => item.detail.includes('复用语音转写缓存')))
    assert.equal(stages.at(-1).stage, 'done')
    assert.deepEqual(stages.at(-1).media.voice, { total: 1, processed: 1, succeeded: 1, failed: 0, cached: 1 })
    assert.deepEqual(stages.at(-1).media.image, { total: 2, processed: 2, succeeded: 1, failed: 1, cached: 0 })
    assert.equal(stages[0].media.voice.processed, 0, '进度事件保存当时的计数，不被后续修改')
    assert.ok(stages.some(item => item.stage === 'voice'))
    assert.ok(stages.some(item => item.stage === 'image'))
    assert.ok(stages.some(item => item.detail.includes('分段整理')))
    assert.equal(result.warnings.length, 1)
    assert.ok(prompts.some(item => item.prompt.includes('离线识别文本')))
    assert.ok(prompts.every(item => !item.prompt.includes('VIDEO_CONTENT_MUST_NOT_BE_PARSED')))
    assert.equal(prompts.filter(item => item.image).length, 1)
    const metadata = JSON.parse(await fs.readFile(path.join(path.dirname(result.htmlPath), 'report.json'), 'utf8'))
    assert.equal(metadata.styleId, input.style)
    assert.equal(metadata.stylePrompt, '聚焦重点与结论')
    assert.equal(metadata.startDate, input.startDate)
    assert.ok(metadata.name.includes(input.conversationName))
    const html = await fs.readFile(result.htmlPath, 'utf8')
    assert.ok(html.includes('&lt;script&gt;test&lt;/script&gt;'))
    assert.ok(html.includes('未下载'))
    assert.equal(result.pngPaths.length, 1, '长报告只导出一张完整PNG')
    for (const file of result.pngPaths) {
      const png = await fs.readFile(file)
      assert.equal(png.subarray(1, 4).toString(), 'PNG')
      assert.ok(png.length > 1000)
      assert.equal(png.readUInt32BE(16), 2000)
      assert.ok(png.readUInt32BE(20) > 4000, '整张长图保留超过分块高度的全部内容')
    }
    const verifyLongImage = async report => {
      const image = nativeImage.createFromPath(report.pngPaths[0])
      const { width, height } = image.getSize()
      const preview = new BrowserWindow({ show: false, width, height: 1000, webPreferences: { zoomFactor: 2, offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } })
      try {
        await preview.loadFile(report.htmlPath)
        assert.equal(await preview.webContents.executeJavaScript('document.documentElement.scrollHeight'), height / 2, 'PNG覆盖整个HTML高度')
        for (const top of [1900, height / 2 - 500]) {
          await preview.webContents.executeJavaScript(`new Promise(resolve => { scrollTo(0, ${top}); requestAnimationFrame(() => requestAnimationFrame(resolve)) })`)
          await new Promise(resolve => setTimeout(resolve, 100))
          const viewport = (await preview.webContents.capturePage()).resize({ width, height: 1000 }).toBitmap({ scaleFactor: 1 })
          const crop = image.crop({ x: 0, y: top * 2, width, height: 1000 }).toBitmap({ scaleFactor: 1 })
          assert.equal(crop.length, viewport.length)
          let different = 0
          for (let index = 0; index < crop.length; index++) if (Math.abs(crop[index] - viewport[index]) > 8) different++
          if (different / crop.length >= .01) { await fs.writeFile('.screenshots/stitch-crop.png', image.crop({ x: 0, y: top * 2, width, height: 1000 }).toPNG()); await fs.writeFile('.screenshots/stitch-expected.png', (await preview.webContents.capturePage()).resize({ width, height: 1000 }).toPNG()) }; assert.ok(different / crop.length < .01, `拼接边界及底部内容与原页面一致 top=${top} ratio=${different / crop.length}`)
        }
      } finally { preview.destroy() }
    }
    await verifyLongImage(result)
    reportLines = 600
    const veryLong = await generateReport(input, voice, () => {}, snapshotData)
    reportLines = 150
    assert.equal(veryLong.pngPaths.length, 1)
    assert.ok(nativeImage.createFromPath(veryLong.pngPaths[0]).getSize().height > 16000, '超长报告也只输出一张PNG')
    await verifyLongImage(veryLong)
    if (process.env.REPORT_TEST_PREVIEW) {
      await fs.mkdir('.screenshots', { recursive: true })
      await fs.copyFile(result.pngPaths[0], '.screenshots/report-generated-test.png')
    }
    const basePrompt = prompts.find(item => item.kind === 'text').prompt
    const originalPromptCount = prompts.length
    const cardResult = await generateReport({ ...input, templateId: 'default' }, voice, () => {}, snapshotData)
    assert.equal(prompts.slice(originalPromptCount).find(item => item.kind === 'text').prompt, basePrompt)
    assert.ok((await fs.readFile(cardResult.htmlPath, 'utf8')).includes('class="layout-daily"'))
    if (process.env.REPORT_TEST_PREVIEW) await fs.copyFile(cardResult.pngPaths[0], '.screenshots/report-cards-test.png')
    const { renderReportHtml } = await import(pathToFileURL(rendererPath).href)
    const { defaultReportTemplates } = await import(pathToFileURL(templatesPath).href)
    for (const template of defaultReportTemplates) {
      const rendered = renderReportHtml({ template, name: '测试', startDate: '2026-10-01', endDate: '2026-10-02', messageCount: 1, counts: { message: 1 }, content: '## 标题\n**重点**\n- <script>内容</script>', warnings: [], width: 1000 })
      assert.ok(rendered.includes(`class="layout-${template.layout}"`))
      assert.ok(rendered.includes('<h2>标题</h2>'))
      assert.ok(rendered.includes('<strong>重点</strong>'))
      assert.ok(rendered.includes('&lt;script&gt;内容&lt;/script&gt;'))
    }
    const previousPrompts = prompts.slice()
    const styleResults = []
    reportLines = 3
    for (const style of ['sharp', 'sarcastic']) {
      prompts.length = 0
      const report = await generateReport({ ...input, style, targetMember: undefined, contentTypes: ['message'] }, voice, () => {}, { ...snapshotData, contentTypes: ['message'], messages: [{ ...fixture[0], text: '真实项目讨论与决定。'.repeat(3500) }], counts: { message: 1, image: 0, voice: 0, video: 0 } })
      const chosen = store.resolveReportStyle(style)
      const textPrompts = prompts.filter(item => item.kind === 'text')
      assert.ok(textPrompts.length > 1, '覆盖中间证据整理与最终生成')
      assert.ok(textPrompts.slice(0, -1).every(item => !item.prompt.includes(chosen.prompt)), '预设表达风格不进入证据压缩')
      assert.ok(textPrompts.at(-1).prompt.includes(chosen.prompt), '最终生成使用预设风格')
      const meta = JSON.parse(await fs.readFile(path.join(path.dirname(report.htmlPath), 'report.json'), 'utf8'))
      assert.equal(meta.styleName, chosen.name)
      assert.equal(meta.stylePrompt, chosen.prompt)
      assert.ok((await fs.readFile(report.htmlPath, 'utf8')).includes('成员确认了下一步行动'))
      assert.equal(report.pngPaths.length, 1)
      styleResults.push(report.content)
    }
    assert.equal(styleResults[0], styleResults[1], '相同模拟事实不被程序随风格改写')
    reportLines = 150
    prompts.splice(0, prompts.length, ...previousPrompts)
    const personalFixture = { ...snapshotData, messages: [{ ...fixture[0], senderId: 'alice', sender: '成员甲', text: '个人发言', from: 'them' }, { ...fixture[0], id: 'self', senderId: 'me', sender: '我', text: '我的发言', from: 'me' }] }
    await generateReport({ ...input, targetMember: { key: 'id:alice', name: '成员甲' } }, voice, () => {}, personalFixture)
    await generateReport({ ...input, targetMember: { key: 'self', name: '我' } }, voice, () => {}, personalFixture)
    await assert.rejects(generateReport({ ...input, targetMember: { key: 'id:unknown', name: '未知' } }, voice, () => {}, personalFixture), /当前范围没有消息/)
    const dailyFixture = { ...snapshotData, messages: fixture.map((message, index) => ({ ...message, senderId: index % 2 ? 'alice' : 'bob', sender: index % 2 ? '成员甲' : '成员乙' })) }
    let avatarLoads = 0
    const dailyResult = await generateReport({ ...input, targetMember: undefined, templateId: 'default' }, voice, () => {}, dailyFixture, async message => message, async members => {
      avatarLoads++
      assert.deepEqual(members.map(member => member.count), [3, 2])
      return members
    })
    assert.equal(avatarLoads, 1)
    const dailyHtml = await fs.readFile(dailyResult.htmlPath, 'utf8')
    assert.ok(dailyHtml.includes(' 日报</h1>'))
    assert.ok(dailyHtml.includes('template-mobile-feed'))
    assert.equal((dailyHtml.match(/class="rank"/g) || []).length, 2)
    feedResponse = true
    invalidFeedTimes = 1
    const feedStages = []
    const feedPromptStart = prompts.length
    const feedResult = await generateReport({ ...input, targetMember: undefined, conversationId: 'test@chatroom', style: 'default', contentTypes: ['message'] }, voice, event => feedStages.push(event), { ...dailyFixture, messages: [{ ...dailyFixture.messages[0], text: '下一步先确认进度。' }] })
    const feedHtml = await fs.readFile(feedResult.htmlPath, 'utf8')
    assert.ok(feedHtml.includes('template-mobile-feed'))
    assert.ok(feedHtml.includes('成员确认了下一步行动。'))
    assert.ok(feedStages.some(event => event.detail.includes('校验日报结构')))
    const feedPrompt = prompts.slice(feedPromptStart).find(item => item.kind === 'text').prompt
    assert.ok(feedPrompt.includes('只输出一个可被 JSON.parse 解析的 JSON 对象'))
    assert.ok(feedPrompt.includes('目标模式：完整版'))
    feedResponse = false
    const volumeMessages = Array.from({ length: 9000 }, (_, index) => ({ ...fixture[0], id: `volume-${index}`, text: '围绕实施方案讨论具体问题、不同意见、处理过程和验证结果。'.repeat(5), sender: `成员${index % 21}`, senderId: `volume-${index % 21}`, createdAt: new Date(2026, 9, 1).getTime() + index * 16000 }))
    const volumeStart = prompts.length
    const volumeStages = []
    const volumeResult = await generateReport({ ...input, targetMember: undefined, conversationId: 'volume@chatroom', contentTypes: ['message'], style: 'detailed' }, voice, event => volumeStages.push(event), { ...snapshotData, messages: volumeMessages })
    const volumePrompts = prompts.slice(volumeStart).filter(item => item.kind === 'text')
    assert.ok(volumePrompts.some(item => item.prompt.includes('不限制本段为800字')))
    assert.ok(volumePrompts.some(item => item.prompt.includes('最多 12 个独立主要话题')))
    assert.ok(volumePrompts.some(item => item.prompt.includes('你正在补全长记录日报') && item.prompt.includes(volumeMessages[0].text)))
    const volumeHtml = await fs.readFile(volumeResult.htmlPath, 'utf8')
    assert.ok(volumeHtml.includes('template-mobile-feed'))
    assert.ok(volumeHtml.includes('处理过程与验证结果'))
    assert.equal((volumeHtml.match(/class="rank"/g) || []).length, 10)
    for (const style of ['default', 'concise', 'natural', 'custom-test']) {
      const styleResult = await generateReport({ ...input, targetMember: undefined, conversationId: 'style@chatroom', contentTypes: ['message'], style }, voice, () => {}, { ...snapshotData, messages: volumeMessages.slice(0, 3) })
      const styleHtml = await fs.readFile(styleResult.htmlPath, 'utf8')
      assert.ok(styleHtml.includes('template-mobile-feed'), `${style} 使用同一默认模板`)
      assert.equal((styleHtml.match(/class="rank"/g) || []).length, 3)
    }
    const customPromptStart = prompts.length
    await generateReport({ ...input, style: 'custom-test' }, voice, () => {}, snapshotData)
    const customCalls = prompts.slice(customPromptStart).filter(item => item.kind === 'text')
    assert.ok(customCalls.length > 1)
    assert.ok(customCalls.every(item => item.prompt.includes('优先整理风险及责任人') && item.prompt.includes('用户自定义的内容要求')))
    assert.ok(customCalls.some(item => item.prompt.includes('请生成最终报告')))
    const partialStages = []
    await generateReport(input, voice, event => partialStages.push(event), { ...snapshotData, messages: [...fixture, { ...fixture[1], id: 'missing-voice', voice: { unavailable: '未下载' } }] })
    assert.deepEqual(partialStages.at(-1).media.voice, { total: 2, processed: 2, succeeded: 1, failed: 1, cached: 1 })
    assert.deepEqual(partialStages.at(-1).media.image, { total: 2, processed: 2, succeeded: 1, failed: 1, cached: 1 })
    assert.equal(prompts.filter(item => item.kind === 'image').length, 1, '多次生成复用图片理解缓存')
    failTextTimes = 1
    const retryStages = []
    await generateReport(input, voice, event => retryStages.push(event), snapshotData)
    assert.ok(retryStages.some(event => event.detail.includes('拆成更小片段重试')))
    failTextTimes = 1
    const finalRetryStages = []
    const shortData = { ...snapshotData, messages: [{ ...fixture[0], text: '短记录', senderId: 'member-a' }] }
    await generateReport(input, voice, event => finalRetryStages.push(event), shortData)
    assert.ok(finalRetryStages.some(event => event.detail.includes('提高输出预算')))
    assert.equal(prompts.at(-1).options.maxTokens, 8192)
    assert.equal(prompts.at(-1).options.continueOnLength, true)
    failTextTimes = 20
    await assert.rejects(generateReport(input, voice, () => {}, shortData), /自动重试后仍失败/)
    failTextTimes = 0
    failImage = true
    await assert.rejects(generateReport({ ...input, targetMember: undefined, conversationId: 'uncached-image' }, voice, () => {}, { ...snapshotData, messages: fixture.filter(message => message.messageType === 3) }), /图片模型不可用/)
    await assert.rejects(generateReport(input, { ...voice, getStatus: async () => ({ state: 'missing' }) }, () => {}, snapshotData), /离线模型/)
    assert.equal(transcriptionCalls, 1, '多次生成均不重复转写')
    voiceOnly = true
    const beforeVoiceOnly = transcriptionCalls
    const voiceStages = []
    const voiceMessage = { ...fixture[1], id: 'voice-only', sender: '语音成员', senderId: 'synthetic-voice-member', voice: undefined, reportMedia: { content: 'synthetic voice metadata' } }
    const voiceReport = await generateReport({ ...input, requestId: 'voice-only', targetMember: undefined, conversationId: 'voice-only@chatroom', contentTypes: ['voice'], style: 'concise' }, voice, event => voiceStages.push(event), { ...snapshotData, conversationId: 'voice-only@chatroom', contentTypes: ['voice'], messages: [voiceMessage], counts: { message: 0, voice: 1, image: 0, video: 0 } }, async message => {
      assert.equal(message.messageType, 34)
      return { ...message, voice: { hex: '1234' } }
    })
    assert.equal(transcriptionCalls, beforeVoiceOnly + 1, '按需取得语音后实际执行转写')
    assert.deepEqual(voiceStages.at(-1).media.voice, { total: 1, processed: 1, succeeded: 1, failed: 0, cached: 0 })
    assert.ok(voiceReport.content.includes('离线识别文本'))
    const voiceHtml = await fs.readFile(voiceReport.htmlPath, 'utf8')
    assert.ok(voiceHtml.includes('离线识别文本'), '最终 HTML 包含语音转写内容')
    assert.ok(voiceHtml.includes('语音成员'), '语音原文引用保留实际发言人')
    assert.ok(voiceReport.pngPaths.length > 0)
    voiceOnly = false
    console.log('报告流程自测通过：报告失败后复用语音缓存、缓存命中不加载离线模型、风格持久化与增删改、模板与内容分离、素材分流、长记录分段、HTML/PNG 输出、语音原文进入总结及报告和失败处理。')
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
    await fs.rm(moduleDirectory, { recursive: true, force: true })
  }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
