export interface ReportTemplate {
  scope?: 'personal'
  id: string
  name: string
  description: string
  layout: 'daily' | 'document' | 'cards' | 'editorial' | 'timeline' | 'letter'
  features: string[]
}

// Templates control presentation only; content requirements belong to writing styles.
export const defaultReportTemplates: ReportTemplate[] = [
  { id: 'default', name: '默认', description: '浅绿信息流日报：摘要与关键结论、讨论热点、真实消息摘录、问答和待跟进事项；空栏目自动隐藏。', layout: 'daily', features: ['信息流排版', '关键结论', '热点与原文', '待办跟进', '真实数据统计'] },
]
