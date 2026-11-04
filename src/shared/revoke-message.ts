function xmlText(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => {
    const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
  }).replace(/&(lt|gt|quot|apos|amp);/g, (_, name: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[name]!)
}
export function parseRevokeMessage(type: number, text: string): { notice: string; targetId?: string } | undefined {
  if (![10000, 10002].includes(type >>> 0)) return undefined
  const body = /<revokemsg\b[^>]*>([\s\S]*?)<\/revokemsg>/i.exec(text)?.[1]
  if (body === undefined && !/撤回/.test(text)) return undefined
  const read = (name: string): string => xmlText(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i').exec(body ?? text)?.[1] || '').trim()
  const targetId = [read('newmsgid'), read('msgid')].find(value => /^\d+$/.test(value) && value !== '0')
  return { notice: read('replacemsg') || read('content') || (body === undefined && !text.includes('<') ? text : '一条消息已撤回'), targetId }
}
