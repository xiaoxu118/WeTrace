export interface MemeEntry { id: string; phrase: string; meaning: string; example: string; tags: string[] }
export interface HotspotConfig { enabled: boolean; url: string; tool: string; argumentsJson: string }
export interface AiKnowledge { memes: MemeEntry[]; hotspot: HotspotConfig }
export interface HotspotResult { text: string; fetchedAt: string; cached: boolean; error?: string }
export const defaultAiKnowledge: AiKnowledge = {
  hotspot: { enabled: false, url: '', tool: 'query_hot_trending', argumentsJson: '{"platform":"all","limit":10}' },
  memes: [
    { id: 'hot-update', phrase: '立场支持热更新', meaning: '调侃短时间内反复改口，前后立场反差明显', example: '他不是没有立场，他的立场支持热更新。', tags: ['改口', '反转', '立场'] },
    { id: 'loading', phrase: '进度条型选手', meaning: '讨论很久、不断预告但尚未行动', example: '别人负责推进，他负责让进度条看起来还活着。', tags: ['拖延', '计划', '行动'] },
    { id: 'plot', phrase: '群聊的编外编剧', meaning: '用出人意料的接话制造剧情反转', example: '大家还在聊天，他已经开始给群聊写番外了。', tags: ['接梗', '反差', '整活'] },
    { id: 'navigation', phrase: '话题导航重新规划', meaning: '一句话让讨论偏离原来的主题', example: '别人负责讨论，他一句话让全群导航重新规划。', tags: ['跑题', '转移话题'] },
    { id: 'silent', phrase: '潜水但精准上线', meaning: '平时少说话，关键时候一句话点中重点', example: '平时像离线，补刀时延迟只有一毫秒。', tags: ['潜水', '补刀', '精准'] },
    { id: 'theory', phrase: '理论已经通关', meaning: '调侃理论准备充分但实际行动尚未开始', example: '理论上已经通关，现实里还在创建角色。', tags: ['理论', '行动', '计划'] },
  ],
}
