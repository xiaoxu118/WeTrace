import { ActionButton } from './ui/ActionButton'
import { Input } from 'antd'
import { useEffect, useState } from 'react'
import { FileText, FolderOpen, RefreshCw } from 'lucide-react'
import type { ReportHistoryItem } from '../../../shared/types'
import { SafeText } from './SafeText'

export function ReportHistory() {
  const [reports, setReports] = useState<ReportHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(20)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void window.wetrace.listReports().then(items => { if (active) setReports(items) }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : '读取报告列表失败')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refresh])
  const filtered = reports.filter(report => `${report.name} ${report.styleName ?? ''} ${report.startDate} ${report.endDate}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const open = async (file: string, folder = false) => {
    try { if (folder) await window.wetrace.revealReport(file); else await window.wetrace.openReport(file) }
    catch (error) { setError(error instanceof Error ? error.message : '打开报告失败，请刷新列表后重试') }
  }
  return <section className="report-history" aria-label="已生成报告">
    <div className="report-history-head"><div><h3>已生成报告 <small>{reports.length} 份</small></h3><p>保存在本机，重启后仍可查看。</p></div><ActionButton type="button" className="btn sm" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={13} />刷新列表</ActionButton></div>
    {!!reports.length && <Input className="inp" aria-label="搜索已生成报告" placeholder="搜索会话或统计日期" value={query} onChange={event => { setQuery(event.target.value); setLimit(20) }} />}
    {error && <p className="report-history-error" role="alert">{error}</p>}
    {loading ? <p className="report-history-empty">正在读取已保存的报告…</p> : !filtered.length ? <p className="report-history-empty">{reports.length ? '没有匹配的报告' : '还没有已保存的报告，生成后会自动出现在这里。'}</p> : <div className="report-history-list">
      {filtered.slice(0, limit).map(report => <article className="report-history-item" key={report.id}>
        <div className="report-history-icon"><FileText size={20} /></div><div className="report-history-copy"><h4><SafeText>{report.name}</SafeText></h4><p>{report.startDate ? `统计日期：${report.startDate}${report.endDate && report.endDate !== report.startDate ? ` 至 ${report.endDate}` : ''}` : '统计日期未记录'}{report.styleName && <span>风格：{report.styleName}</span>}<span>生成于 {new Date(report.createdAt).toLocaleString('zh-CN')}</span></p><small title={report.htmlPath}>{report.htmlPath.replace(/[\\/][^\\/]+$/, '')}</small></div>
        <div className="report-history-actions"><ActionButton type="button" className="btn sm primary" onClick={() => void open(report.htmlPath)}>打开报告</ActionButton>{report.pngPaths.map((file, index) => <ActionButton type="button" className="btn sm" key={file} onClick={() => void open(file)}>查看 PNG{report.pngPaths.length > 1 ? ` ${index + 1}` : ''}</ActionButton>)}<ActionButton type="button" className="btn sm" onClick={() => void open(report.htmlPath, true)}><FolderOpen size={13} />打开文件夹</ActionButton></div>
      </article>)}
      {filtered.length > limit && <ActionButton type="button" className="btn sm" onClick={() => setLimit(value => value + 20)}>显示更多报告（还有 {filtered.length - limit} 份）</ActionButton>}
    </div>}
  </section>
}
