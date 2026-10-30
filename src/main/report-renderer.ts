import { parseReportFeed, renderReportFeed } from '../shared/report-feed'
import { cleanReportText, cleanReportSummary, splitReportTopics, topicParticipants, topicMessageCount, type ReportMessageAuthor } from '../shared/report-topics'
import type { ReportParticipant } from '../shared/report-facts'
import { escapeReportHtml as escape } from './report-model'
import type { ReportTemplate } from '../shared/report-templates'

interface ReportDocument {
  styleId?: string
  template: ReportTemplate
  name: string
  startDate: string
  endDate: string
  messageCount: number
  counts: Record<string, number>
  content: string
  sourceMessages?: { reference: string; sender: string; text: string; time: string }[]
  warnings: string[]
  width: number
  firstAt?: number
  lastAt?: number
  participants?: ReportParticipant[]
  participantCount?: number
  members?: ReportParticipant[]
  messageAuthors?: ReportMessageAuthor[]
}

// Render only escaped model text and a small Markdown subset; model HTML is never executed.
function renderBody(text: string): string {
  const inline = (line: string) => escape(line).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  const lines = text.trim().split('\n')
  const output: string[] = []
  let paragraph: string[] = []
  let list: string[] = []
  const flush = () => {
    if (paragraph.length) { output.push(`<p>${paragraph.map(inline).join('<br>')}</p>`); paragraph = [] }
    if (list.length) { output.push(`<ul>${list.map(line => `<li>${inline(line)}</li>`).join('')}</ul>`); list = [] }
  }
  for (const line of lines) {
    const item = /^\s*(?:[-*+] |\d+[.)、] )(.*)/.exec(line)
    const subheading = /^###\s+(.+)$/.exec(line)
    if (subheading) { flush(); output.push(`<h3>${inline(subheading[1])}</h3>`); continue }
    if (/^>\s?/.test(line)) { flush(); output.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); continue }
    if (!line.trim()) { flush(); continue }
    if (item) {
      if (paragraph.length) flush()
      list.push(item[1])
    } else {
      if (list.length) flush()
      paragraph.push(line)
    }
  }
  flush()
  return output.join('')
}

export function renderReportHtml(document: ReportDocument): string {
  const { template, name, startDate, endDate, messageCount, counts, content, warnings, width } = document
  if (template.layout === 'daily' && /^(?:\s*\{|\s*```json)/.test(content)) return renderReportFeed(parseReportFeed(content), document)
  const sections: { title: string; lines: string[] }[] = []
  for (const line of content.split('\n')) {
    const heading = /^#{1,2}\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) sections.push({ title: heading[1], lines: [] })
    else {
      if (!sections.length) sections.push({ title: '', lines: [] })
      sections[sections.length - 1].lines.push(line)
    }
  }
  const daily = template.layout === 'daily'
  const summarySection = sections.find(section => /^(概要|摘要|整体概览|概览)$/.test(section.title))
  const summaryText = (summarySection?.lines.join(' ') || sections.flatMap(section => section.lines).find(line => line.trim() && !line.startsWith('#')) || '本时段仅包含统计记录，未提供可分析的正文。').replace(/[*#>]/g, '').replace(/\s+/g, ' ').trim()
  const summary = cleanReportSummary(summaryText) || '本时段暂无可提炼的讨论概要。'
  const datePart = (value: number) => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
  const clock = (value: number) => { const date = new Date(value); return [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => String(n).padStart(2, '0')).join(':') }
  const actualRange = document.firstAt !== undefined && document.lastAt !== undefined
    ? datePart(document.firstAt) === datePart(document.lastAt) ? `${clock(document.firstAt)} — ${clock(document.lastAt)}` : `${datePart(document.firstAt)} ${clock(document.firstAt)} — ${datePart(document.lastAt)} ${clock(document.lastAt)}`
    : '暂无有效消息时段'
  const participants = (document.participants ?? []).slice(0, 5)
  const memberAvatar = (member: ReportParticipant, compact = false) => {
    const source = member.avatar && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(member.avatar) ? member.avatar : undefined
    const photo = `<span class="participant-photo">${source ? `<img src="${escape(source)}" alt="${escape(member.name)}">` : `<span>${escape([...member.name][0] || '人')}</span>`}</span>`
    return compact ? `<span class="topic-member" title="${escape(member.name)}">${photo}<b>${escape(member.name)}</b></span>` : `<div class="participant" title="${escape(member.name)} · ${member.count} 条">${photo}</div>`
  }
  const avatars = participants.map(member => memberAvatar(member)).join('')
  const displaySections = daily ? sections.filter(section => section !== summarySection && (section.title || section.lines.some(line => line.trim()))) : sections
  const title = daily ? `${name} 日报` : name
  const dailyStats = `<div class="daily-stats"><div><b>${messageCount}</b><span>MESSAGES</span></div><div><b>${document.participantCount ?? participants.length}</b><span>PARTICIPANTS</span></div><div><b>${counts.voice ?? 0}</b><span>VOICE</span></div><div><b>${counts.image ?? 0}</b><span>IMAGES</span></div></div>`
  const cover = daily ? `<div class="brand">WETRACE · 群聊日报</div><h1>${escape(title)}</h1><div class="daily-date">${escape(startDate === endDate ? startDate : `${startDate} 至 ${endDate}`)}<span class="actual-range">${escape(actualRange)}</span></div><div class="daily-summary">${escape(summary)}</div>${participants.length ? `<div class="participant-strip" aria-label="发言前五名"><div class="participants">${avatars}</div></div>` : ''}${dailyStats}` : `<div class="brand">WETRACE · ${escape(template.name)}</div><h1>${escape(title)}</h1><div class="meta">${escape(startDate)} 至 ${escape(endDate)} · ${messageCount} 条记录 · 视频仅统计</div><div class="stats">STATS_PLACEHOLDER</div>`
  const labels: Record<string, string> = { message: '消息', voice: '语音', image: '图片', video: '视频' }
  const stats = Object.entries(counts).map(([key, value]) => `<div><b>${value}</b><span>${labels[key] || escape(key)}</span></div>`).join('')
  const ranking = daily && participants.length ? `<section class="report-section"><header><h2>发言排行</h2></header><div class="speech-ranking">${(document.members ?? participants).slice().sort((a, b) => b.count - a.count).slice(0, 10).map((member, index) => `<div><span>${index + 1}</span>${memberAvatar(member, true)}<b>${member.count} 条</b></div>`).join('')}</div></section>` : ''
  const body = displaySections.map((section, index) => {
    const isTopics = daily && /热点|话题|讨论/.test(section.title) && section.lines.some(line => /^###\s/.test(line))
    const topics = isTopics ? splitReportTopics(section.lines) : []
    const maximum = Math.max(0, ...topics.map(topic => topicMessageCount([topic.title, ...topic.lines].join('\n'))))
    const content = isTopics ? topics.map(topic => {
      const count = topicMessageCount([topic.title, ...topic.lines].join('\n'))
      const heat = !count ? 'unknown' : count / maximum >= 0.67 ? 'high' : count / maximum >= 0.34 ? 'medium' : 'low'
      const heatLabel = { high: '高热', medium: '中热', low: '低热', unknown: '未统计' }[heat]
      const heatTitle = count ? '按本报告各话题引用的不同消息数量相对计算热度' : '该话题缺少消息引用，暂无法统计热度'
      const members = topicParticipants([topic.title, ...topic.lines].join('\n'), document.members ?? participants, document.messageAuthors ?? [])
      return `<article class="topic-card"><span class="topic-heat heat-${heat}" title="${heatTitle}" aria-label="话题热度：${heatLabel}">${heatLabel}</span>${topic.title ? `<h3>${escape(cleanReportText(topic.title))}</h3>` : ''}${renderBody(cleanReportText(topic.lines.join('\n')))}${members.length ? `<div class="topic-members" aria-label="话题相关成员">${members.slice(0, 8).map(member => memberAvatar(member, true)).join('')}${members.length > 8 ? `<span class="topic-more">+${members.length - 8} 人</span>` : ''}</div>` : ''}</article>`
    }).join('') : renderBody(daily ? cleanReportText(section.lines.join('\n')) : section.lines.join('\n'))
    return `<section class="report-section${isTopics ? ' topic-section' : ''}"><header><span class="section-number">${String(index + 1).padStart(2, '0')}</span>${section.title ? `<h2>${escape(daily ? cleanReportText(section.title) : section.title)}</h2>` : ''}</header>${content}</section>`
  }).join('')
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${escape(title)} · ${escape(template.name)}</title><style>
*{box-sizing:border-box}html{scrollbar-width:none}::-webkit-scrollbar{display:none}body{margin:0;background:#f1f4f8;color:#263347;font:16px/1.9 system-ui,sans-serif;--accent:#4364cc;--surface:#fff}main{max-width:${width}px;margin:auto;padding:40px;background:var(--surface);min-height:100vh}.cover{border-bottom:1px solid #dce2ec;padding-bottom:26px;margin-bottom:24px}.brand{font-size:11px;font-weight:700;letter-spacing:2px;color:var(--accent)}h1{font-size:32px;line-height:1.45;margin:16px 0 12px;overflow-wrap:anywhere}.meta{color:#778297;font-size:12px}.stats{display:flex;flex-wrap:wrap;gap:28px;padding-top:22px}.stats div{display:flex;align-items:baseline;gap:8px}.stats b{font-size:24px;font-weight:650}.stats span{font-size:12px;color:#778297}.report-section{padding:18px 0;overflow-wrap:anywhere;min-width:0}.report-section header{display:flex;align-items:center;gap:10px}h2{font-size:20px;line-height:1.6;margin:0 0 14px}.section-number{display:none}p{margin:0 0 14px}ul{margin:0 0 14px;padding-left:24px}li{margin:5px 0}aside{margin-top:28px;padding:18px;background:#fff5df;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}footer{border-top:1px solid #e1e6ed;margin-top:28px;padding-top:16px;color:#8490a2;font-size:11px}
.layout-cards{--accent:#5363d7;--surface:#f4f5fb}.layout-cards .cover{background:#273b86;color:white;border:0;border-radius:18px;padding:30px}.layout-cards .cover .brand,.layout-cards .cover .meta,.layout-cards .stats span{color:#d6ddff}.layout-cards .report-section{background:white;padding:24px;border:1px solid #e5e7f2;border-radius:14px;margin-bottom:18px;box-shadow:0 4px 14px #24304405}.layout-cards h2{color:var(--accent)}
.layout-editorial{--accent:#1d5148}.layout-editorial .cover{border-bottom:3px double #667a72}.layout-editorial h1,.layout-editorial h2{font-family:Georgia,'Songti SC',serif}.layout-editorial .report-body{columns:2;column-gap:34px;column-rule:1px solid #e0e6e2}.layout-editorial .report-section{break-inside:avoid;border-bottom:1px solid #e0e6e2}.layout-editorial h1{font-size:40px}
.layout-timeline{--accent:#16776e}.layout-timeline .report-body{padding-left:14px}.layout-timeline .report-section{border-left:2px solid #c8e3dd;padding:8px 0 24px 28px;position:relative}.layout-timeline .report-section:before{content:'';position:absolute;left:-6px;top:19px;width:10px;height:10px;border:2px solid var(--accent);border-radius:50%;background:white}.layout-timeline .section-number{display:block;font-size:12px;color:var(--accent);margin-bottom:14px}
.layout-letter{--accent:#956e48;--surface:#fffaf0;font-family:Georgia,'Songti SC',serif;line-height:2.1}.layout-letter .cover{border-bottom:1px dashed #d8c4a7}.layout-letter main{border-left:8px solid #e8d8bd;border-right:8px solid #e8d8bd}.layout-letter .report-section{padding:20px 0}.layout-letter h2{color:#8a643f;font-size:21px}
@media(max-width:600px){main{padding:26px 22px}h1,.layout-editorial h1{font-size:26px}.layout-editorial .report-body{columns:1}.layout-cards .cover{padding:24px}.stats{gap:18px}.layout-timeline .report-section{padding-left:22px}}

.layout-daily{--accent:#26986a;--surface:#f0f5f2;background:#f0f5f2;color:#253b30;font-size:14px;line-height:1.85}.layout-daily main{padding:28px 20px 24px}.layout-daily .cover{padding:0;margin:0 0 22px;border:0}.layout-daily .brand{color:#37a478;font-size:9px;letter-spacing:2px}.layout-daily h1{font-size:26px;font-weight:800;letter-spacing:-.6px;line-height:1.4;margin:12px 0 10px}.daily-date{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 12px;font-size:11px;color:#6e8276;font-variant-numeric:tabular-nums}.actual-range{font-size:10px}.daily-summary{background:#e1f3e8;border-radius:12px;padding:15px 16px;margin:18px 0 15px;color:#375746;font-size:13px;line-height:1.9}.participant-strip{padding:0 1px 16px}.participants{display:flex;gap:14px;align-items:flex-start}.participant{width:50px;text-align:center;min-width:0}.participant-photo{position:relative;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border:2px solid white;border-radius:50%;background:#dcebe2;color:#50775f;font-weight:700}.participant-photo img{width:100%;height:100%;border-radius:50%;object-fit:cover}.participant-photo i{position:absolute;bottom:-2px;right:-4px;display:grid;place-items:center;width:15px;height:15px;background:#329a6b;border:1.5px solid white;border-radius:50%;font:8px system-ui;color:white}.participant>b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:500;margin-top:6px}.participant small,.participant-strip>small{display:block;font-size:9px;color:#8b9b90;line-height:1.6}.participant-strip>small{margin-top:12px}.daily-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.daily-stats>div{background:white;border:1px solid #e8efea;border-radius:9px;padding:12px 8px}.daily-stats b{font-size:22px;line-height:1.3;display:block;letter-spacing:-.6px}.daily-stats span{font-size:9px;color:#8b9b90}.layout-daily .report-section{background:white;border:1px solid #e6eee8;border-radius:13px;padding:18px 16px;margin:0 0 15px;box-shadow:0 2px 8px #31503c03}.layout-daily .report-section h2{font-size:16px;font-weight:750;margin:0 0 15px}.layout-daily h3{font-size:14px;line-height:1.6;margin:18px 0 8px;padding-top:14px;border-top:1px solid #edf2ee}.layout-daily p{font-size:12px;line-height:1.95;margin-bottom:12px}.layout-daily ul{font-size:12px;padding-left:18px}.layout-daily li::marker{color:#31a578}.layout-daily blockquote{background:#edf7f0;border-left:3px solid #83c69d;padding:9px 12px;margin:10px 0 14px;font-size:12px;color:#47715a;border-radius:0 6px 6px 0}.layout-daily footer{font-size:9px;color:#91a295;border-color:#dce7df}.layout-daily aside{border-radius:10px;font-size:11px}
@media(min-width:700px){.layout-daily main{padding:40px 44px}.layout-daily .daily-summary{font-size:15px}.layout-daily .report-section{padding:24px}.layout-daily .report-section p,.layout-daily .report-section ul{font-size:14px}.layout-daily h1{font-size:34px}.layout-daily .daily-stats>div{padding:16px}}

.layout-daily .participants{justify-content:flex-start;gap:0}.layout-daily .participant{text-align:left;width:38px;flex:0 0 38px}.layout-daily .participant+.participant{margin-left:-9px}.layout-daily .participant-photo{margin:0}.layout-daily .participant-photo i{display:none}.daily-stats span{font-size:8px;letter-spacing:.3px}.layout-daily .report-section.topic-section{background:none;border:0;box-shadow:none;padding:0;margin-bottom:20px}.layout-daily .topic-section>header h2{margin:0 0 12px;padding-left:2px}.topic-card{position:relative;background:#fff;border:1px solid #e0eae3;border-radius:12px;padding:18px 16px;margin:0 0 12px;overflow-wrap:anywhere}.layout-daily .topic-card h3{margin:0 0 10px;padding:0 48px 0 0;border:0;font-size:15px;line-height:1.7}.layout-daily .topic-card p{margin:0 0 12px}.topic-members{display:flex;align-items:center;flex-wrap:wrap;gap:9px 12px;margin-top:14px;padding-top:12px;border-top:1px solid #edf2ef}.topic-member{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-width:0}.topic-member .participant-photo{width:23px;height:23px;border-width:1px;font-size:10px;flex:0 0 23px}.topic-member b{font-size:10px;line-height:1.5;color:#718479;font-weight:500;overflow-wrap:anywhere}.topic-more{color:#91a295;font-size:10px}
.topic-heat{position:absolute;right:16px;top:20px;border-radius:4px;padding:1px 6px;font-size:10px;line-height:1.8;font-weight:600;white-space:nowrap}.heat-high{background:#fff0e5;color:#c76b28}.heat-medium{background:#edf5ef;color:#608370}.heat-low,.heat-unknown{background:#f0f3f2;color:#85948b}
.speech-ranking{display:grid;gap:12px}.speech-ranking>div{display:flex;align-items:center;gap:10px;font-size:12px}.speech-ranking>div>b{margin-left:auto;font-weight:500;color:#6a746e}
</style><body class="layout-${template.layout}"><main><div class="cover">${cover.replace('STATS_PLACEHOLDER', stats)}</div><article class="report-body">${body}${ranking}</article>${warnings.length ? `<aside>素材处理说明\n${escape(warnings.join('\n'))}</aside>` : ''}<footer>WeTrace · 基于所选聊天记录生成</footer></main></body></html>`
}
