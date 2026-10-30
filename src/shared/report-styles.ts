export interface ReportWritingStyle {
  scope?: 'personal'
  id: string
  name: string
  prompt: string
  builtin: boolean
}

export interface SaveReportStyleInput {
  id?: string
  name: string
  prompt: string
}

export const defaultReportStyles: ReportWritingStyle[] = [
  { id: 'default', name: '默认', builtin: true, prompt: '写成一份可快速浏览的中文群聊日报。必须以“## 概要”开头，用40–80字概括本次聊天的主要话题、整体进展与关键结论，不要开场白或泛泛评价。概要只描述讨论内容，禁止出现消息条数、参与人数、语音视频数量、统计口径或覆盖说明。随后按实际记录选择“## 今日讨论热点”“## 重要发言”“## 原文摘录”“## 问题与解答”“## 待跟进事项”“## 资源与链接”“## 关键词”等章节；没有依据的章节直接省略。讨论热点按“### 具体话题标题”拆分，每个话题用2–4句话交代讨论内容、分歧与结论，可附真实消息时间；每个话题末尾用隐藏注释 <!-- refs: r1,r2 --> 列出实际支撑该话题的输入消息编号，供程序匹配参与成员。正文不出现#115568、方括号编号、消息编号列表。重要发言和原文摘录只展示真实发言人和时间，不改写为虚构引语。问题与解答只配对记录中已有的问答，待跟进事项只记录明确的负责人、时间或未解决问题；未提及的标明未提及。少用长段落与重复内容，语言自然、具体、客观。统计时段、人数、发言排名由程序计算，不自行编造；不评价人格、推测心理或虚构“今日之最”。' },
  { id: 'concise', name: '简洁摘要', prompt: '使用简洁、客观的语言，聚焦重点与结论。优先呈现核心话题、明确决定和关键事项，省略重复讨论，保留重要原文依据。', builtin: true },
  { id: 'detailed', name: '详尽纪要', prompt: '使用正式、清晰的语言，详细交代讨论背景、不同观点、过程和结论。整理明确的待办、负责人和时间，区分已确认与待确认事项，保留原文依据。', builtin: true },
  { id: 'natural', name: '自然回顾', prompt: '使用自然、平实的语言串联聊天内容，回顾主要话题和重要时刻。表达流畅，保留有价值的细节与原文依据，不夸大、不推测未提及的信息。', builtin: true },
  { id: 'personal-concise', scope: 'personal', name: '个人重点摘要', prompt: '简洁、客观地总结指定成员的主要发言、明确观点和讨论贡献。以本人发言为依据，将他人的回应作为上下文，保留消息编号；没有表达的观点不要补充。', builtin: true },
  { id: 'personal-detailed', scope: 'personal', name: '个人参与纪要', prompt: '按话题详细整理指定成员的观点、理由、相关对话及观点变化，明确区分本人表达与他人回应。列出该成员明确承诺的事项、时间和待确认问题，不将群体任务归给本人，保留原文依据。', builtin: true },
  { id: 'personal-natural', scope: 'personal', name: '个人自然回顾', prompt: '用自然、平实的语言回顾指定成员在所选时间内参与的讨论、重要表达和互动。结合上下文串联过程，区分他人评价与本人陈述，不推断性格、心理或未表达的立场，保留原文依据。', builtin: true },
]
