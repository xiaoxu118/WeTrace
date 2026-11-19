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
 data.conversations[0].id='watch@chatroom';
 data.conversations[0].messages=[{id:'notice',createdAt:Date.now(),messageType:10000,from:'them',sender:'系统',text:'小明撤回了一条消息',time:'12:00'}];
 api.loadAiChatHistory=async()=>({ok:true,archive:{chats:[],activeId:null},revision:0});
 api.saveAiChatHistory=async()=>({ok:true,revision:1});
 let state={rooms:[],events:[]};const configurations=[];api.monitorConfigurations=async()=>configurations;
 api.listConversationOptions=async()=>({ok:true,conversations:[{id:'watch@chatroom',name:'产品讨论群',type:'group'},{id:'other@chatroom',name:'历史项目群',type:'group'},...Array.from({length:25},(_,index)=>({id:'private-contact-'+index,name:'联系人 '+String(index+1).padStart(2,'0'),type:'friend'}))]});
 let otherGroupReads=0;
 api.listGroupMembers=async ({conversationId})=>{
  await new Promise(resolve=>setTimeout(resolve,300));
  if(conversationId==='other@chatroom') return ++otherGroupReads===1
   ? {ok:false,error:'测试群成员读取失败'}
   : {ok:true,members:[{id:'private-other-member',name:'另一群的成员'}]};
  return {ok:true,members:[{id:'private-member-1',name:'同名成员'},{id:'private-member-2',name:'同名成员'}]};
 };
 const profileRequests=[];
 const profileTime=Date.now();
 const profileMessage={id:'profile-message',createdAt:profileTime,target:true,speaker:0,text:'先确认测试范围，再安排复查。'};
 api.profileRequests=async()=>profileRequests;
 api.generatePersonProfile=async input=>{
  profileRequests.push(input);
  return {ok:true,profile:{from:profileTime-86400000,to:profileTime,evidence:[{anchor:profileMessage,messages:[profileMessage]}],observations:[{title:'先确认范围',detail:'讨论复查时先确认测试范围。',references:[1]}]}};
 };
 api.getIndexedConversation=async query=>query.conversationId!=='watch@chatroom'||query.at!==profileTime
  ? {ok:false,error:'测试消息不匹配'}
  : {ok:true,conversation:{...data.conversations[0],messages:[...data.conversations[0].messages,{...profileMessage,messageType:1,from:'them',sender:'同名成员',time:'12:00'}]}};
 let holdPoll=false,releasePoll;
 api.holdMonitorPoll=async()=>{holdPoll=true};
 api.releaseMonitorPoll=async()=>{holdPoll=false;releasePoll?.()};
 api.groupMonitor=async query=>{
  if(query.action==='poll' && holdPoll) await new Promise(resolve=>{releasePoll=resolve});
  if(query.action==='configure') {configurations.push(query.rooms);state.rooms=query.rooms.map(room=>({...room,startedAt:Date.now(),messages:[]}));}
  if(query.action==='poll' && state.rooms.some(room=>room.enabled)) {
   state.rooms[0].checkedAt=Date.now();
   state.rooms[0].messages=[{id:'captured',revokeNoticeId:'notice',at:Date.now(),sender:'小明',from:'them',text:'周五下午发布新版本',type:1,revoked:true}];
   state.events=[{id:'recall',room:'watch@chatroom',kind:'revoked',at:Date.now(),sender:'小明',text:'小明撤回了一条消息',original:'周五下午发布新版本'}, {id:'left',room:'watch@chatroom',kind:'left',at:Date.now(),sender:'小李',text:'已不在最新群成员名单中（无法区分主动退群或被移出）'}];
  }
  return {ok:true,data:structuredClone(state)};
 };
 contextBridge.exposeInMainWorld('wetrace', api)
 `)
 const preload = path.resolve('.cache/group-monitor-ui-preload.cjs')
 await fs.writeFile(preload, source)
 const window = new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload,sandbox:false,offscreen:true,partition:'group-monitor-'+Date.now()}})
 window.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message)})
 const run = code => window.webContents.executeJavaScript(code)
 const until = async code => {for(let i=0;i<80;i++){if(await run(code))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('UI timeout: '+code)}
 try {
  await window.loadFile(path.resolve('out/renderer/index.html'))
  await until(`!!document.querySelector('button[aria-label="群聊监控"]')`)
  await run(`document.querySelector('button[aria-label="群聊监控"]').click()`)
  await until(`!!document.querySelector('.group-monitor') && getComputedStyle(document.querySelector('.group-monitor')).display !== 'none'`)
  await run(`void (window.originalMonitorPanel = document.querySelector('.group-monitor'))`)
  await run(`document.querySelector('button[aria-label="画像"]').click()`)
  await until(`!!document.querySelector('.profiles-view .ant-select')`)
  const click = async selector => {
   await until(`(() => {
     const element = document.querySelector(${JSON.stringify(selector)})
     if (!element) return false
     const rect = element.getBoundingClientRect()
     return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
   })()`)
   const point = await run(`(() => {
     const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
     return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
   })()`)
   window.webContents.sendInputEvent({type:'mouseMove',...point})
   window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point})
   window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})
  }
  await click('.profiles-view .ant-select')
  await until(`document.querySelectorAll('.profile-select-popup .ant-select-item-option').length === 20`)
  assert.equal(await run(`!!document.querySelector('.profile-select-popup .ant-pagination')`), false)
  assert.equal(await run(`document.querySelector('.profile-select-popup').textContent.includes('private-contact-')`), false)
  await run(`(() => {
    const list = document.querySelector('.profile-select-popup .ant-select-dropdown-list-holder')
    list.scrollTop = list.scrollHeight
  })()`)
  await until(`!!document.querySelector('.profile-select-popup .ant-select-item-option[title="联系人 25"]') && document.querySelectorAll('.profile-select-popup .ant-select-item-option').length === 25`)
  await run(`document.querySelector('.profiles-view input').focus()`)
  window.webContents.insertText('联系人 02')
  await until(`!!document.querySelector('.ant-select-item-option[title="联系人 02"]') && document.querySelectorAll('.profile-select-popup .ant-select-item-option').length === 1`)
  await click('.ant-select-item-option[title="联系人 02"]')
  await until(`!document.querySelector('.profiles-view .btn.primary').disabled && document.querySelector('.profiles-view .ant-select').textContent.includes('联系人 02')`)
  assert.equal(await run(`document.querySelector('.profiles-view').textContent.includes('private-contact-')`), false)
  await run(`[...document.querySelectorAll('.profiles-view .ant-segmented-item')].find(item => item.textContent === '群成员').click()`)
  await click('.profiles-view .ant-select')
  await click('.profile-select-popup:not(.ant-select-dropdown-hidden) [title="产品讨论群"]')
  await until(`document.querySelectorAll('.profiles-view .ant-select').length === 2`)
  await until(`!document.querySelector('.profiles-view .ant-select-loading')`)
  await click('.profile-select + .profile-select .ant-select')
  await click('.profile-select-popup:not(.ant-select-dropdown-hidden) [title="同名成员（2）"]')
  await until(`!document.querySelector('.profiles-view .btn.primary').disabled && document.querySelector('.profiles-view').textContent.includes('同名成员（2）')`)
  await click('.profiles-view .btn.primary')
  await until(`document.querySelector('.profile-observations')?.textContent.includes('先确认范围')`)
  const [profileRequest] = await run('window.wetrace.profileRequests()')
  assert.deepEqual(profileRequest.target, {kind:'group-member',root:'/test',groupId:'watch@chatroom',memberId:'private-member-2'})
  await click('.profile-observations button')
  await until(`document.querySelector('.ant-modal')?.textContent.includes('先确认测试范围，再安排复查。')`)
  await click('.ant-modal-footer button')
  await until(`!!document.querySelector('[data-message-id="profile-message"]')`)
  await click('button[aria-label="画像"]')
  await until(`document.querySelector('.profile-observations')?.textContent.includes('先确认范围')`)
  await click('.profiles-view .ant-select')
  await click('.profile-select-popup:not(.ant-select-dropdown-hidden) [title="历史项目群"]')
  await until(`document.querySelector('.profiles-view .ant-alert')?.textContent.includes('测试群成员读取失败') && document.querySelector('.profiles-view .btn.primary').disabled`)
  assert.equal(await run(`!!document.querySelector('.profile-observations')`),false)
  await click('.profiles-view .ant-alert button')
  await until(`!document.querySelector('.profiles-view .ant-alert, .profiles-view .ant-select-loading')`)
  await click('.profile-select + .profile-select .ant-select')
  await click('.profile-select-popup:not(.ant-select-dropdown-hidden) [title="另一群的成员"]')
  await until(`!document.querySelector('.profiles-view .btn.primary').disabled`)
  for (const tab of ['消息', '群聊监控', '设置']) {
   await run(`document.querySelector('button[aria-label="画像"]').click()`)
   await until(`!!document.querySelector('.profiles-view')`)
   await run(`document.querySelector('button[aria-label="${tab}"]').click()`)
   assert.equal(await run(`document.querySelectorAll('.profiles-view').length`), 0, `切换至${tab}后应移除画像页`)
   assert.equal(await run(`document.querySelector('.group-monitor') === window.originalMonitorPanel`), true, '群聊监控应保留原面板')
  }
  await run(`document.querySelector('button[aria-label="群聊监控"]').click()`)
  await run(`Array.from(document.querySelectorAll('.monitor-filters button')).find(button=>button.textContent.includes('新建事件')).click()`)
  await until(`!!document.querySelector('.ant-modal')`)
  assert.ok(await run(`document.querySelector('.ant-modal').textContent.includes('事件类型')`))
  const modalPoint=await run(`(()=>{const r=document.querySelector('.ant-modal .ant-select').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
  window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...modalPoint})
  window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...modalPoint})
  await run(`(()=>{const input=document.querySelector('.ant-modal .ant-select input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'历史项目');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await until(`!!document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="历史项目群"]') && !document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="产品讨论群"]')`)

  await run(`document.querySelector('.ant-modal .ant-select-item-option[title="历史项目群"]').click()`)
  await run(`document.querySelector('.ant-modal .ant-btn-primary').click()`)
  await until(`!document.querySelector('.ant-modal')`)
  const configurations=await run('window.wetrace.monitorConfigurations()')
  assert.equal(configurations[0][0].id,'other@chatroom')
  assert.deepEqual(configurations[0][0].eventKinds,['message'])
  await until(`!!document.querySelector('.monitor-filters .ant-select')`)
  const point=await run(`(()=>{const r=document.querySelector('.monitor-filters .ant-select').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
  window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point})
  window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})
  await until(`!!document.querySelector('.ant-select-item-option[title="产品讨论群"]')`)
  await run(`document.querySelector('.ant-select-item-option[title="产品讨论群"]').click()`)
  await until(`Array.from(document.querySelectorAll('.monitor-filters button')).some(button=>button.textContent.includes('开启'))`)
  await run(`Array.from(document.querySelectorAll('.monitor-filters button')).find(button=>button.textContent.includes('开启')).click()`)
  await until(`document.querySelector('.monitor-events').textContent.includes('小李')`)
  assert.equal(await run(`document.querySelector('.monitor-events').textContent.includes('周五下午发布新版本')`), false)
  assert.equal(await run(`!!document.querySelector('.monitor-revoked')`), false)
  assert.equal(await run(`Array.from(document.querySelectorAll('.monitor-controls select option')).some(option=>option.value==='revoked')`), false)
  assert.ok(await run(`document.querySelector('.monitor-events').textContent.includes('小李')`))
  await until(`Array.from(document.querySelectorAll('.monitor-filters button')).some(button=>button.textContent.includes('暂停'))`)
  await run(`document.querySelector('button[aria-label="消息"]').click()`)
  await until(`getComputedStyle(document.querySelector('.group-monitor')).display==='none'`)
  await until(`document.querySelector('.message-recalled')?.textContent.includes('周五下午发布新版本')`)
  assert.ok(await run(`document.querySelector('.message-recall-label').textContent.includes('已撤回')`))
  assert.ok(await run(`document.querySelector('.sender').textContent.includes('小明')`))
  await run(`document.querySelector('button[aria-label="群聊监控"]').click()`)
  await until(`getComputedStyle(document.querySelector('.group-monitor')).display!=='none'`)
  await new Promise(resolve=>setTimeout(resolve,250))
  await fs.mkdir('.screenshots',{recursive:true})
  await fs.writeFile('.screenshots/group-monitor.png',(await window.webContents.capturePage()).toPNG())
  await run(`Array.from(document.querySelectorAll('.monitor-filters button')).find(button=>button.textContent.includes('暂停')).click()`)
  await until(`Array.from(document.querySelectorAll('.monitor-filters button')).some(button=>button.textContent.includes('开启'))`)
  console.log('群聊监控 UI 测试通过：入口、群聊选择、开启/暂停、撤回仅显示在聊天记录、监控隐藏撤回事件、离群事件与切换页面。')
 } finally {window.destroy();await fs.rm(preload,{force:true})}
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)})
