const { app, BrowserWindow, nativeImage, protocol } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
protocol.registerSchemesAsPrivileged([{scheme:'wetrace-media',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}])
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
 let videoRequests=0
 const reference = await fs.readFile(path.resolve('scripts/test-report-ui.cjs'), 'utf8')
 const marker = 'await fs.writeFile(preload, `', begin = reference.indexOf(marker) + marker.length
 let source = reference.slice(begin, reference.indexOf('\n`)', begin))
 const avatar = nativeImage.createFromBitmap(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 }).toDataURL()
 source = source.replace("contextBridge.exposeInMainWorld('wetrace', api)", `
 data.conversations[0].messages=[
  {id:'pat',createdAt:500,messageType:10000,from:'them',sender:'成员乙',text:'成员乙拍了拍你',time:'11:59'},
  {id:'join',createdAt:600,messageType:10002,from:'me',text:'你邀请成员丙加入了群聊',time:'11:59'},
  {id:'captured',createdAt:1000,messageType:10000,from:'me',text:'你撤回了一条消息',revoke:{},recall:{original:'会话中已捕获的原文[微笑]',originalAt:1000},time:'12:00'},
  {id:'missing',createdAt:2000,messageType:10000,from:'me',text:'你撤回了一条消息',revoke:{unresolvedReason:'unlinked'},time:'12:01'},
  {id:'member-notice',createdAt:3000,messageType:10002,from:'them',senderId:'bob',sender:'其他成员',text:'撤回通知',avatar:'data:image/png;base64,invalid',revoke:{},time:'12:02'},
  {id:'recalled-image',createdAt:300,messageType:10002,from:'them',text:'撤回',revoke:{},recall:{original:'[图片]',originalAt:300,media:{image:{source:${JSON.stringify(avatar)}}}},time:'11:58'},
  {id:'recalled-video',createdAt:400,messageType:10002,from:'them',text:'撤回',revoke:{},recall:{original:'[视频]',originalAt:400,media:{video:{source:'wetrace-media://retained/'+ 'a'.repeat(64)+'/'+ 'b'.repeat(64)+'/'+ 'c'.repeat(64)}}},time:'11:58'},
 ];
 api.groupMonitor=async()=>({ok:true,data:{rooms:[{id:'test@chatroom',name:'产品讨论群',enabled:false,startedAt:0,avatars:{alice:${JSON.stringify(avatar)}},messages:[{id:'member-original',at:2000,type:1,sender:'成员甲',senderId:'alice',from:'them',text:'成员撤回的原文',revoked:true,revokeNoticeId:'member-notice'}]}],events:[]}});
 contextBridge.exposeInMainWorld('wetrace', api)
 `)
 const preload = path.resolve('.cache/chat-recall-ui-preload.cjs')
 await fs.writeFile(preload, source)
 const window = new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload,sandbox:false,offscreen:true,partition:'chat-recalls-'+Date.now()}})
 window.webContents.session.protocol.handle('wetrace-media', () => {videoRequests++;return new Response(null,{status:404})})
 const run = code => window.webContents.executeJavaScript(code)
 const until = async code => {for(let i=0;i<80;i++){if(await run(code))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('UI timeout: '+code)}
 try {
  await window.loadFile(path.resolve('out/renderer/index.html'))
  await until(`document.querySelector('.message-recalled')?.textContent.includes('会话中已捕获的原文')`)
  for (const id of ['pat', 'join', 'missing']) {
   assert.ok(await run(`(() => {const row=document.querySelector('[data-message-id="${id}"]');return row.classList.contains('message-system') && !row.querySelector('.profile-avatar, .sender, .bubble, .tm') && getComputedStyle(row).justifyContent === 'center'})()`), '系统消息应居中且无头像、昵称、气泡和行内时间')
  }
  assert.ok(await run(`document.querySelector('[data-message-id="pat"]').textContent.includes('成员乙拍了拍你')`))
  assert.ok(await run(`document.querySelector('.message-recalled').textContent.includes('已保留原文')`))
  assert.ok(await run(`document.querySelector('.message-revoke-notice').textContent.includes('你撤回了一条消息')`))
  assert.ok(await run(`document.querySelector('.message-revoke-notice').textContent.includes('已保存会话消息，但暂无法确定对应原文')`))
  assert.equal(await run(`document.querySelector('.message-revoke-notice').textContent.includes('<sysmsg')`),false)
  assert.ok(await run(`document.querySelector('.message-recalled').closest('.mrow').classList.contains('me')`))
  await until(`document.querySelector('[data-message-id="member-notice"] .message-recalled')?.textContent.includes('成员撤回的原文')`)
  await until(`document.querySelector('[data-message-id="member-notice"] .profile-avatar img')?.complete`)
  assert.equal(await run(`document.querySelector('[data-message-id="member-notice"] .profile-avatar img').getAttribute('src')`), avatar)
  assert.equal(await run(`document.querySelector('[data-message-id="member-notice"] .sender').textContent`), '成员甲')
  assert.equal(await run(`document.querySelector('[data-message-id="member-notice"]').classList.contains('me')`), false)
  await until(`document.querySelector('[data-message-id="recalled-image"] .message-image')?.complete`)
  assert.equal(await run(`document.querySelector('[data-message-id="recalled-image"] .message-image').getAttribute('src')`), avatar)
  assert.ok(await run(`document.querySelector('[data-message-id="recalled-image"]').textContent.includes('已保留图片')`))
  assert.ok(await run(`document.querySelector('[data-message-id="recalled-video"]').textContent.includes('已保留视频')`))
  assert.ok(await run(`(() => { const video=document.querySelector('[data-message-id="recalled-video"] video');return video && video.controls && video.getAttribute('src').startsWith('wetrace-media://retained/') })()`), '撤回视频使用保留文件并显示播放控件')
  await run(`document.querySelector('[data-message-id="recalled-video"] video').load()` )
  for(let i=0;i<20 && !videoRequests;i++) await new Promise(resolve=>setTimeout(resolve,50))
  assert.ok(videoRequests > 0, '视频保留文件可通过媒体协议加载，不被页面安全策略阻止')

  console.log('聊天撤回 UI 测试通过：未开启群监控时展示已捕获原文、未捕获提示、可读通知、本人消息方向和原发言人头像、撤回图片和视频控件。')
 } finally {window.destroy();await fs.rm(preload,{force:true})}
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)})
