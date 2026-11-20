export interface ReportTemplate {
  scope?: 'personal'
  id: string
  name: string
  description: string
  layout: 'daily' | 'document' | 'cards' | 'editorial' | 'timeline' | 'letter'
  features: string[]
}

export const commentaryReportTemplateId = 'topic-commentary'

// Templates choose which report sections to display; writing styles control their expression.
export const defaultReportTemplates: ReportTemplate[] = [
  { id: 'default', name: '默认', description: '浅绿信息流日报：摘要与关键结论、讨论热点、真实消息摘录、问答和待跟进事项；空栏目自动隐藏。', layout: 'daily', features: ['信息流排版', '关键结论', '热点与原文', '待办跟进', '真实数据统计'] },
  { id: commentaryReportTemplateId, name: '话题点评', description: '在每个讨论话题下展示 AI 评论。', layout: 'daily', features: ['AI 评论', '热点与原文', '发言排行'] },
]
