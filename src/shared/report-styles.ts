export interface ReportWritingStyle {
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
]
