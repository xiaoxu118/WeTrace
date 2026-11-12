const { app, BrowserWindow, nativeImage, protocol } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
protocol.registerSchemesAsPrivileged([{scheme:'wetrace-media',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}])
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const reference = await fs.readFile(path.resolve('scripts/test-report-ui.cjs'), 'utf8')
  const marker = 'await fs.writeFile(preload, `', begin = reference.indexOf(marker) + marker.length
  let source = reference.slice(begin, reference.indexOf('\n`)',begin))
  const thumbnail = nativeImage.createFromBitmap(Buffer.from([0,0,255,255]),{width:1,height:1}).toDataURL()
  const original = nativeImage.createFromBitmap(Buffer.from([255,0,0,255,255,0,0,255,255,0,0,255,255,0,0,255]),{width:2,height:2}).toDataURL()
  const retained = 'wetrace-media://retained/'+['a','b','c'].map(letter=>letter.repeat(64)).join('/')
  source = source.replace("contextBridge.exposeInMainWorld('wetrace', api)", `
const thumbnails = [${JSON.stringify(retained)},${JSON.stringify(thumbnail)},${JSON.stringify(thumbnail)}]
data.conversations[0].messages=thumbnails.map((source,index)=>({id:'image-'+index,createdAt:(index+1)*1000,messageType:3,from:'them',time:'12:00',text:'[图片]',image:{source,thumbnail:true}}))
const previews=[]
api.getIndexedConversation=async query=>{previews.push(query); const index=query.at/1000-1;const message=data.conversations[0].messages[index];return {ok:true,conversation:{...data.conversations[0],messages:[{...message,image:index===2?message.image:{source:${JSON.stringify(original)},thumbnail:false}}]}}}
api.originalPreviewQueries=async()=>previews
contextBridge.exposeInMainWorld('wetrace', api)
`)
  await fs.mkdir('.cache',{recursive:true})
  const preload=path.resolve('.cache/original-image-ui-preload.cjs')
  await fs.writeFile(preload,source)
  const window = new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload,sandbox:false,offscreen:true,partition:'original-preview-'+Date.now()}})
  window.webContents.session.protocol.handle('wetrace-media',()=>new Response(nativeImage.createFromDataURL(thumbnail).toPNG(),{headers:{'Content-Type':'image/png'}}))
  const run=code=>window.webContents.executeJavaScript(code)
  const until=async code=>{for(let i=0;i<80;i++){if(await run(code))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('UI timeout: '+code)}
  try {
    await window.loadFile(path.resolve('out/renderer/index.html'))
    await until(`document.querySelectorAll('.chat-scroll .message-image').length===3`)
    for(const index of [0,1,2]) {
      await run(`document.querySelector('[data-message-id="image-${index}"] .message-image').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
      await until(`window.wetrace.originalPreviewQueries().then(queries=>queries.some(query=>query.at===${(index+1)*1000}))`)
      const expected=index===2?thumbnail:original
      await until(`document.querySelector('.ant-image-preview-img')?.getAttribute('src')===${JSON.stringify(expected)}`)
      if(index===2) assert.ok(await run(`document.querySelector('.image-preview-note').textContent.includes('当前为缩略图')`),'没有原图时显示实际状态并保留缩略图')
      else assert.ok(await run(`!document.querySelector('.image-preview-note')`),'成功读取原图后清除缩略图状态')
      await run(`document.querySelector('.ant-image-preview-close').click()`)
      await new Promise(resolve=>setTimeout(resolve,300))
    }
    assert.equal((await run('window.wetrace.originalPreviewQueries()')).length,3)
    console.log('原图预览界面通过：加密缓存缩略图和data图片重新读取原图、自动切换清晰版本、无原图时保留缩略图。')
  } finally {window.destroy();await fs.rm(preload,{force:true})}
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)})
