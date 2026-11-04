const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
app.on('window-all-closed',()=>{})
app.whenReady().then(async()=>{
 const reference=await fs.readFile(path.resolve('scripts/test-report-ui.cjs'),'utf8')
 const marker='await fs.writeFile(preload, `'
 const begin=reference.indexOf(marker)+marker.length
 let source=reference.slice(begin,reference.indexOf('\n`)',begin))
 source=source.replace("contextBridge.exposeInMainWorld('wetrace', api)",`
 const requests=[]; let delta=()=>{}; let release; let hold=false
 api.holdAi=async()=>{hold=true}
 api.releaseAi=async()=>{hold=false;release?.()}
 api.onAiProgress=()=>()=>{}
 api.onAiDelta=callback=>{delta=callback;return ()=>{}}
 api.listModelConfigs=async()=>[{id:'test-model',name:'测试模型',kind:'text',source:'remote',isDefault:true},{id:'volcano',name:'火山引擎',kind:'image',source:'remote'},{id:'speech-local',name:'本地语音',kind:'speech',source:'local'},{id:'speech-remote',name:'在线语音',kind:'speech',source:'remote'}]
 data.conversations[0].messages.push({id:'forward',createdAt:1000,messageType:81604378673,from:'them',text:'群聊记录',forwarded:{title:'群聊记录',entries:[{sender:'原发言者',time:'昨天',text:'合并转发里的任务'}]}})
 data.conversations[1]={...data.conversations[1],id:'friend',name:'另一位联系人',type:'friend',messages:[{id:'other',createdAt:2000,messageType:1,from:'them',text:'另一段独立内容'}]}
 api.askAi=async input=>{requests.push(input);if(hold){delta({requestId:input.requestId,text:'仅属于原会话的部分输出'});await new Promise(resolve=>{release=resolve})}await new Promise(resolve=>setTimeout(resolve,100));delta({requestId:input.requestId,text:'整理完成'});return {ok:true,answer:'整理完成'}}
 api.aiContextRequests=async()=>requests
 contextBridge.exposeInMainWorld('wetrace', api)
 `)
 await fs.mkdir('.cache',{recursive:true})
 const preload=path.resolve('.cache/conversation-options-ui-preload.cjs')
 source=source.replace("contextBridge.exposeInMainWorld('wetrace', api)", `
 let catalogFails=false;
 api.setCatalogFailure=async value=>{catalogFails=value};
 api.listConversationOptions=async()=>catalogFails?{ok:false,error:'目录读取失败，请重试'}:{ok:true,conversations:[{id:'older@chatroom',name:'历史项目群',type:'group'},{id:'old-friend',name:'历史联系人',type:'friend'}]};
 contextBridge.exposeInMainWorld('wetrace', api)
 `)
 await fs.writeFile(preload,source)
 const window=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload,sandbox:false,offscreen:true,partition:'ask-conversation-'+Date.now()}})
 const run=async code=>{try{return await window.webContents.executeJavaScript(code)}catch(error){throw new Error(code+": "+error.message)}}
 const until=async code=>{for(let i=0;i<80;i++){if(await run(code))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('UI timeout '+code+' '+await run('document.body.innerText.slice(0,800)'))}
 try {
  await window.loadFile(path.resolve('out/renderer/index.html'))
  await until(`!!document.querySelector('button[aria-label="AI 对话"]')`)
  await run(`document.querySelector('button[aria-label="AI 对话"]').click()`)
  const click=async selector=>{
   const point=await run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
   window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point})
   window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})
  }
  await click('.ai-model-select')
  await until(`!![...document.querySelectorAll('.ant-dropdown-menu-item')].find(e=>e.textContent.includes('火山引擎'))`)
  assert.equal(await run(`document.querySelector('.ant-dropdown-menu').textContent.includes('语音')`),false)
  await new Promise(resolve=>setTimeout(resolve,300))
  await run(`document.querySelectorAll('.ant-dropdown-menu-item')[1].setAttribute('data-test-model','volcano')`)
  await click('[data-test-model="volcano"]')
  await until(`document.querySelector('.ai-model-select').textContent.includes('火山引擎')`)
  await click('.ai-context-label')
  assert.equal(await run(`!!document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')`),false)
  const historyBefore=await run(`document.querySelectorAll('.ai-history-row').length`)
  const initialWidth=await run(`document.querySelector('.ai-context-picker').getBoundingClientRect().width`)
  await click('.ai-context-select')
  await until(`!!document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)') && document.querySelector('.ant-select-dropdown').textContent.includes('历史项目群')`)
  assert.equal(await run(`!!document.querySelector('[role=dialog]')`),false)
  await new Promise(resolve=>setTimeout(resolve,300))
  await click('.ai-context-select input')
  window.webContents.insertText('历史项目')
  await until(`!document.querySelector('.ant-select-dropdown').textContent.includes('历史联系人')`)
  await until(`document.querySelectorAll('.ant-select-item-option').length===2`)
  await run(`(()=>{const input=document.querySelector('.ai-context-select input');input.focus();input.select()})()`)
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Backspace'})
  window.webContents.sendInputEvent({type:'keyUp',keyCode:'Backspace'})
  await until(`document.querySelector('.ant-select-dropdown').textContent.includes('历史联系人')`)
  window.webContents.insertText('历史项目')
  await until(`document.querySelectorAll('.ant-select-item-option').length===2`)

  await new Promise(resolve=>setTimeout(resolve,250))
  await fs.writeFile('.screenshots/ai-conversation-search.png',(await window.webContents.capturePage()).toPNG())
  assert.ok(await run(`(()=>{const e=document.querySelector('.ant-select-item-option[title="历史项目群"]');const r=e.getBoundingClientRect();return r.x>=0 && r.y>=0 && r.right<=innerWidth && r.bottom<=innerHeight && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.ant-select-item-option')===e})()`))
  await click('.ant-select-item-option[title="历史项目群"]')
  await until(`document.querySelector('.ai-context-select').textContent.includes('历史项目群')`)
  assert.equal(await run(`document.querySelectorAll('.ai-history-row').length`),historyBefore,'selecting a source must not create history before a question is sent')
  await until(`document.querySelector('.ai-context-select input').getAttribute('aria-expanded')==='false'`)
  await until(`document.querySelector('.ai-context-picker').getBoundingClientRect().width<${initialWidth}`)
  await run(`(()=>{const input=document.querySelector('[aria-label="向 AI 提问"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'总结讨论');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  window.webContents.debugger.attach('1.3')
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await run(`window.wetrace.holdAi()`)
  await run(`document.querySelector('[aria-label="发送消息"]').click()`)
  await until(`!!document.querySelector('.ai-working .ai-send-spinner')`)
  const animationBefore=await run(`(()=>{const e=document.querySelector('.ai-working .ai-send-spinner');const s=getComputedStyle(e);return {name:s.animationName,iterations:s.animationIterationCount,duration:s.animationDuration,time:e.getAnimations()[0]?.currentTime}})()`)
  assert.equal(animationBefore.iterations,'infinite')
  assert.equal(animationBefore.duration,'1s')
  await new Promise(resolve=>setTimeout(resolve,200))
  const animationAfter=await run(`document.querySelector('.ai-working .ai-send-spinner').getAnimations()[0]?.currentTime`)
  assert.ok(animationAfter>animationBefore.time,'loading animation must continue during generation with reduced motion enabled')
  await run(`window.wetrace.releaseAi()`)
  window.webContents.debugger.detach()

  await until(`document.querySelectorAll('.ai-turn.assistant').length===1 && !document.querySelector('.ai-working')`)
  assert.equal(await run(`document.querySelectorAll('.ai-history-row').length`),historyBefore+1,'first send creates exactly one history entry')
  const requests=await run(`window.wetrace.aiContextRequests()`)
  assert.ok(Number.isFinite(requests[0].turns[0].createdAt),'user messages must store their send time')
  assert.equal(await run(`getComputedStyle(document.querySelector('.ai-user-message-actions')).visibility`),'hidden')
  const hoverPoint=await run(`(()=>{const r=document.querySelector('.ai-turn.user').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
  window.webContents.sendInputEvent({type:'mouseMove',...hoverPoint})
  await until(`getComputedStyle(document.querySelector('.ai-user-message-actions')).visibility==='visible'`)
  assert.ok(await run(`!!document.querySelector('.ai-user-message-actions time[datetime]')`))
  const rowHover=await run(`(()=>{const r=document.querySelector('.ai-message-row.user').getBoundingClientRect();return {x:Math.round(r.x+5),y:Math.round(r.y+5)}})()`)
  window.webContents.sendInputEvent({type:'mouseMove',...rowHover})
  await until(`getComputedStyle(document.querySelector('.ai-user-message-actions')).visibility==='visible'`)
  const gapHover=await run(`(()=>{const r=document.querySelector('.ai-turn.user').getBoundingClientRect();return {x:Math.round(r.right-10),y:Math.round(r.bottom+3)}})()`)
  window.webContents.sendInputEvent({type:'mouseMove',...gapHover})
  await until(`getComputedStyle(document.querySelector('.ai-user-message-actions')).visibility==='visible'`)
  await run(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.testCopiedMessage=text}}})`)
  await click('[aria-label="复制消息"]')
  await until(`window.testCopiedMessage==='总结讨论' && !!document.querySelector('[aria-label="已复制消息"]')`)
  await click('.ai-assistant-message-actions [aria-label="复制消息"]')
  await until(`window.testCopiedMessage==='整理完成' && !!document.querySelector('.ai-assistant-message-actions [aria-label="已复制消息"]')`)
  assert.equal(await run(`document.querySelector('.ai-assistant-message-actions .ai-copy-feedback').textContent`),'')
  assert.equal(requests[0].modelId,'volcano')
  assert.equal(requests[0].context.conversationId,'older@chatroom')
  assert.ok(requests[0].conversations.some(item=>item.id==='older@chatroom'))
  console.log('Ant Design 会话选择测试通过：鼠标展开、搜索过滤、鼠标选择、完整目录和提问上下文；固定标签不触发选择，无弹窗。')
 } finally { window.destroy();await fs.rm(preload,{force:true}) }
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)})
