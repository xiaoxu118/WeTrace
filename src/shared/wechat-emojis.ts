// Display equivalents only. Keep the bracket tokens intact in stored/searchable message text.
const emojis: Record<string, string> = {
  微笑: '🙂', 撇嘴: '😒', 色: '😍', 发呆: '😳', 得意: '😎', 流泪: '😢', 害羞: '☺️', 闭嘴: '🤐', 睡: '😴', 大哭: '😭',
  尴尬: '😅', 发怒: '😡', 调皮: '😜', 呲牙: '😁', 惊讶: '😮', 难过: '🙁', 酷: '😎', 冷汗: '😰', 抓狂: '😫', 吐: '🤮',
  偷笑: '🤭', 愉快: '😊', 可爱: '🥰', 白眼: '🙄', 傲慢: '😏', 饥饿: '😋', 困: '🥱', 惊恐: '😱', 流汗: '😓', 憨笑: '😄',
  悠闲: '😌', 大兵: '😎', 奋斗: '💪', 咒骂: '🤬', 疑问: '❓', 嘘: '🤫', 晕: '😵', 疯了: '🤪', 衰: '😞', 骷髅: '💀',
  敲打: '🔨', 再见: '👋', 擦汗: '😅', 抠鼻: '👃', 鼓掌: '👏', 糗大了: '😳', 坏笑: '😏', 左哼哼: '😤', 右哼哼: '😤', 哈欠: '🥱',
  鄙视: '👎', 委屈: '🥺', 快哭了: '🥺', 阴险: '😏', 亲亲: '😘', 吓: '😱', 可怜: '🥺', 菜刀: '🔪', 西瓜: '🍉', 啤酒: '🍺',
  咖啡: '☕', 猪头: '🐷', 玫瑰: '🌹', 凋谢: '🥀', 嘴唇: '💋', 爱心: '❤️', 心碎: '💔', 蛋糕: '🎂', 炸弹: '💣', 便便: '💩',
  月亮: '🌙', 太阳: '☀️', 礼物: '🎁', 拥抱: '🤗', 强: '👍', 弱: '👎', 握手: '🤝', 胜利: '✌️', 抱拳: '🙏', 勾引: '🫴',
  拳头: '✊', 差劲: '👎', 爱你: '🤟', NO: '🙅', OK: '👌', 跳跳: '🕴️', 发抖: '🫨', 转圈: '💃', 合十: '🙏', 庆祝: '🎉',
  福: '🧧', 红包: '🧧', 发财: '🧧', 点赞: '👍', 赞: '👍', 笑脸: '😄', 生病: '😷', 破涕为笑: '😂', 吐舌: '😛', 脸红: '😳',
  恐惧: '😱', 失望: '😞', 无语: '😑', 嘿哈: '😄', 捂脸: '🤦', 奸笑: '😏', 机智: '😎', 皱眉: '😟', 耶: '✌️', 吃瓜: '🍿',
  加油: '💪', 汗: '😓', 天啊: '😱', Emm: '🤔', 社会社会: '🙏', 旺柴: '🐶', 好的: '👌', 打脸: '🤦', 哇: '😮', 翻白眼: '🙄',
  666: '👍', 让我看看: '🧐', 叹气: '😮‍💨', 苦涩: '🥲', 裂开: '🫠', 敬礼: '🫡', 打call: '📣',
}
export interface WechatTextPart { text: string; emoji?: string; name?: string }
export function splitWechatEmojis(text: string, hasImage?: (name: string) => boolean): WechatTextPart[] {
  const parts: WechatTextPart[] = []
  let start = 0
  for (const match of text.matchAll(/\[([^\[\]\r\n]{1,12})\]/g)) {
    const emoji = Object.hasOwn(emojis, match[1]) ? emojis[match[1]] : undefined
    if (!emoji && !hasImage?.(match[1])) continue
    if (match.index! > start) parts.push({ text: text.slice(start, match.index) })
    parts.push({ text: match[0], emoji, name: match[1] })
    start = match.index! + match[0].length
  }
  if (start < text.length || !parts.length) parts.push({ text: text.slice(start) })
  return parts
}
