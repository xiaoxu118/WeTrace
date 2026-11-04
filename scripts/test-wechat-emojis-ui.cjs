const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
 const reference = await fs.readFile(path.resolve('scripts/test-report-ui.cjs'), 'utf8')
 const marker = 'await fs.writeFile(preload, `', begin = reference.indexOf(marker) + marker.length
 let source = reference.slice(begin, reference.indexOf('\n`)', begin))
 source = source.replace("contextBridge.exposeInMainWorld('wetrace', api)", `
 data.conversations[0].messages=[
  {id:'text',createdAt:Date.now(),messageType:1,from:'them',sender:'测试成员',text:'收到[微笑][捂脸]，继续[加油] 😀 [未知表情]',time:'12:00'},
  {id:'quote',createdAt:Date.now(),messageType:49,from:'them',sender:'测试成员',text:'谢谢[合十]',quote:{sender:'另一成员',text:'辛苦了[强]'},time:'12:01'},
  {id:'sticker',createdAt:Date.now(),messageType:47,from:'them',sender:'测试成员',text:'[表情] 测试动图',sticker:{label:'测试动图',source:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'},time:'12:02'},
  {id:'missing',createdAt:Date.now(),messageType:47,from:'them',sender:'测试成员',text:'[表情]',sticker:{label:'表情包',unavailable:'未找到可显示的本地表情包，请在微信中打开后刷新'},time:'12:03'}
 ];
 let attempts=0;
 data.conversations[0].messages[2].sticker.source=undefined;
 data.conversations[0].messages[2].sticker.md5='abcdef0123456789abcdef0123456789';
 data.conversations[0].messages[2].sticker.cdnUrl='https://emoji.qpic.cn/fixture.gif';
 api.resolveSticker=async()=>{attempts++;return attempts===1?{ok:false,error:'表情包链接已过期，请重试'}:{ok:true,source:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}};
 api.stickerAttempts=async()=>attempts;
 api.groupMonitor=async()=>({ok:true,data:{rooms:[],events:[]}});
 contextBridge.exposeInMainWorld('wetrace', api)
 `)
 const preload = path.resolve('.cache/wechat-emojis-ui-preload.cjs')
 await fs.writeFile(preload, source)
 const window = new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload,sandbox:false,offscreen:true,partition:'wechat-emojis-'+Date.now()}})
 const run = code => window.webContents.executeJavaScript(code)
 const until = async code => {for(let i=0;i<80;i++){if(await run(code))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('UI timeout: '+code)}
 try {
  await window.loadFile(path.resolve('out/renderer/index.html'))
  await until(`document.querySelectorAll('.bubble .wechat-emoji').length===5`)
  assert.ok(await run(`!!document.querySelector('.bubble [aria-label="[微笑]"]')`))
  await until(`Array.from(document.querySelectorAll('.wechat-emoji-image')).length>=4 && Array.from(document.querySelectorAll('.wechat-emoji-image')).every(img=>img.complete && img.naturalWidth>0)`)
  assert.ok(await run(`!!document.querySelector('.message-quote [aria-label="[强]"]')`))
  assert.ok(await run(`document.querySelector('.bubble').textContent.includes('[未知表情]')`))
  assert.equal(await run(`document.querySelector('.bubble').textContent.includes('[微笑]')`), false)
  await until(`Array.from(document.querySelectorAll('.sticker-unavailable')).some(el=>el.textContent.includes('链接已过期'))`)
  await run(`document.querySelector('.sticker-retry').click()`)
  await until(`document.querySelector('.message-sticker')?.complete && document.querySelector('.message-sticker').naturalWidth>0`)
  assert.equal(await run('window.wetrace.stickerAttempts()'),2)
  assert.equal(await run(`document.querySelector('.message-sticker').alt`), '测试动图')
  assert.ok(await run(`Array.from(document.querySelectorAll('.sticker-unavailable')).some(el=>el.textContent.includes('请在微信中打开后刷新'))`))
  console.log('表情 UI 测试通过：正文和引用文字表情、原生 emoji、未知表情回退、GIF 加载和本地缺失提示。')
 } finally {window.destroy();await fs.rm(preload,{force:true})}
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)})
