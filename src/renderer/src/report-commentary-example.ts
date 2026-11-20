import { renderReportFeed } from '../../shared/report-feed'

export const commentaryReportExample = renderReportFeed({
  hero: {
    headline: '读书会确定下次选书方式',
    summary: '成员同意先收集候选书目，再投票决定共读书目。',
  },
  topics: [{
    title: '候选书目与投票安排',
    summary: '小林建议每人提交一本候选书，小周提议周末投票。两人同意随书目附上一句推荐理由。',
    aiComment: '先征集书目再投票，兼顾了提名机会和决策效率。一句推荐理由能帮大家比较没读过的书。',
    sourceMessageIds: ['r1', 'r2'],
  }],
}, {
  name: '周末读书会',
  startDate: '2026-10-17',
  endDate: '2026-10-17',
  messageCount: 2,
  width: 1000,
  members: [{ key: 'lin', name: '小林', count: 1 }, { key: 'zhou', name: '小周', count: 1 }],
  messageAuthors: [{ reference: 'r1', key: 'lin' }, { reference: 'r2', key: 'zhou' }],
  sourceMessages: [
    { reference: 'r1', sender: '小林', text: '每人提一本书，附上一句推荐理由。', time: '10:00' },
    { reference: 'r2', sender: '小周', text: '赞成，周末投票。', time: '10:02' },
  ],
  warnings: [],
}, true)
