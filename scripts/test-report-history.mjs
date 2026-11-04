import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { listReportHistory } from '../src/main/report-history.ts'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wetrace-report-history-'))
try {
  assert.deepEqual(await listReportHistory(path.join(root, 'missing')), [])
  const legacy = path.join(root, '1793345650199-legacy')
  await fs.mkdir(legacy)
  await fs.writeFile(path.join(legacy, 'report.html'), '<title>旧群 &amp; 同事 日报 · 默认</title><div>2026-10-26 至 2026-10-27</div>')
  await fs.writeFile(path.join(legacy, 'report-1.png'), '')
  await fs.writeFile(path.join(legacy, 'report-original-430px.png'), '')
  const recent = path.join(root, '1793345650999-new')
  await fs.mkdir(recent)
  await fs.writeFile(path.join(recent, 'report.html'), '<title>报告</title>')
  await fs.writeFile(path.join(recent, 'report.json'), JSON.stringify({ name: '新群', startDate: '2026-10-30', endDate: '2026-10-30', htmlPath: '/outside', styleId: 'custom-old', styleName: '生成时的风格' }))
  await fs.writeFile(path.join(recent, 'report.png'), '')
  await fs.mkdir(path.join(root, '1793345651000-incomplete'))
  await fs.mkdir(path.join(root, '1793345651001-symlink'))
  await fs.symlink(path.join(recent, 'report.html'), path.join(root, '1793345651001-symlink', 'report.html'))
  const first = await listReportHistory(root)
  assert.equal(first.length, 2)
  assert.equal(first[0].name, '新群')
  assert.equal(first[0].styleId, 'custom-old')
  assert.equal(first[0].styleName, '生成时的风格')
  assert.equal(first[1].styleName, undefined)
  assert.equal(first[0].htmlPath, path.join(recent, 'report.html'), '路径从真实目录构造，不信任元数据路径')
  assert.equal(first[1].name, '旧群 & 同事 日报')
  assert.equal(first[1].startDate, '2026-10-26')
  assert.equal(first[1].endDate, '2026-10-27')
  assert.equal(first[1].pngPaths.length, 1, '不将备份图片列为导出文件')
  assert.deepEqual(await listReportHistory(root), first, '重启或重复读取不依赖内存注册表')
  await fs.unlink(path.join(recent, 'report.png'))
  assert.equal((await listReportHistory(root))[0].pngPaths.length, 0)
  await fs.writeFile(path.join(recent, 'report.json'), 'null')
  assert.equal((await listReportHistory(root)).length, 2, '损坏元数据回退读取HTML')
  console.log('报告历史测试通过：重启复用、新旧报告导入、时间排序、路径校验、备份排除、缺失文件和元数据回退。')
} finally { await fs.rm(root, { recursive: true, force: true }) }
