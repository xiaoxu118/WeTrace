// Synthetic PNGs and a mock clipboard; the system clipboard is never changed.
const { app, nativeImage, ClipboardItem } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { stripTypeScriptTypes } = require('node:module')
const { pathToFileURL } = require('node:url')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wetrace-copy-test-'))
  let copied
  globalThis.reportClipboardFixture = { nativeImage, ClipboardItem, clipboard: { write: async items => { assert.equal(items.length, 1); assert.deepEqual(items[0].types, ['image/png']); const blob = await items[0].getType('image/png'); copied = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())) } } }
  try {
    const source = (await fs.readFile('src/main/report-clipboard.ts', 'utf8')).replace("import { clipboard, ClipboardItem, nativeImage } from 'electron'", 'const { clipboard, ClipboardItem, nativeImage } = globalThis.reportClipboardFixture')
    const modulePath = path.join(directory, 'clipboard.mjs')
    await fs.writeFile(modulePath, stripTypeScriptTypes(source))
    const { copyReportImages } = await import(pathToFileURL(modulePath).href)
    const first = path.join(directory, 'report-1.png'), second = path.join(directory, 'report-2.png')
    const firstPixels = Buffer.from([0, 0, 255, 255, 0, 255, 0, 255])
    const secondPixels = Buffer.from([255, 0, 0, 255])
    await fs.writeFile(first, nativeImage.createFromBitmap(firstPixels, { width: 2, height: 1 }).toPNG())
    await fs.writeFile(second, nativeImage.createFromBitmap(secondPixels, { width: 1, height: 1 }).toPNG())
    const allowed = new Set([first, second])
    await copyReportImages([first], allowed)
    assert.deepEqual(copied.getSize(), { width: 2, height: 1 })
    assert.deepEqual(copied.toBitmap(), firstPixels)
    await copyReportImages([first, second], allowed)
    assert.deepEqual(copied.getSize(), { width: 2, height: 2 })
    assert.deepEqual(copied.toBitmap(), Buffer.concat([firstPixels, secondPixels, Buffer.from([255, 255, 255, 255])]), '多张图片按顺序合并，不丢页、不缩放')
    const previous = copied
    await assert.rejects(copyReportImages([], allowed), /报告图片不存在/)
    await assert.rejects(copyReportImages(null, allowed), /报告图片不存在/)
    await assert.rejects(copyReportImages([first], new Set()), /报告图片不存在/)
    const html = path.join(directory, 'report.html')
    allowed.add(html)
    await assert.rejects(copyReportImages([html], allowed), /报告图片不存在/)
    const missing = path.join(directory, 'missing.png')
    allowed.add(missing)
    await assert.rejects(copyReportImages([first, missing], allowed), /报告图片不存在/)
    await fs.writeFile(second, 'invalid image')
    await assert.rejects(copyReportImages([first, second], allowed), /报告图片无法读取/)
    assert.equal(copied, previous, '读取或校验失败时不修改剪贴板')
    console.log('报告图片复制测试通过：单图、多图顺序合并、像素保真、路径校验、文件缺失与损坏处理。')
  } finally {
    delete globalThis.reportClipboardFixture
    await fs.rm(directory, { recursive: true, force: true })
  }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
