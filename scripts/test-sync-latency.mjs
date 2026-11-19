import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'
import { SyncPresentationCache } from '../src/main/sync-presentation-cache.ts'
import { recoverCapturedAttachments } from '../src/main/recall-attachment-recovery.ts'
import { configureConversationCachePolicy } from '../src/main/conversation-cache-policy.ts'
const cache=new SyncPresentationCache(),row={id:'1',type:3,createTime:1,content:'<img/>',isSend:false,sender:'fixture'}
let reads=0
const load=()=>{reads++;return {text:'[图片]',image:{source:'wetrace-media://retained/fixture',thumbnail:false,hashes:['a'.repeat(32)]}}}
for(let i=0;i<100;i++)cache.read('/fixture','key','room',row,load)
assert.equal(reads,1,'100次数据库变化不能100次重新读取解密同一原图')
cache.invalidate('/fixture','msg/attach/a.dat');cache.read('/fixture','key','room',row,load)
assert.equal(reads,1,'已经独立保留的原图不必因附件变化重复读取')
cache.read('/fixture','key','room',{...row,content:'<img changed/>'},load);assert.equal(reads,2)
cache.read('/other','key','room',row,load);assert.equal(reads,3)
cache.read('/fixture','other-key','room',row,load);assert.equal(reads,4)
cache.clear('/fixture');cache.read('/fixture','key','room',row,load);assert.equal(reads,5)
let thumbnails=0
const partial={...row,id:'thumb'},loadThumb=()=>{thumbnails++;return {text:'[图片]',image:{source:'saved-thumbnail',thumbnail:true,hashes:['b'.repeat(32)]}}}
cache.read('/fixture','key','room',partial,loadThumb)
cache.invalidate('/fixture','msg/attach/unrelated.png');cache.read('/fixture','key','room',partial,loadThumb);assert.equal(thumbnails,1)
cache.invalidate('/fixture','msg/attach/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb_hd.dat');cache.read('/fixture','key','room',partial,loadThumb);assert.equal(thumbnails,2,'相关原图落盘后应重新解析缩略图对应媒体')
let missing=0
const loadMissing=()=>{missing++;return {text:'[视频]',video:{unavailable:'未下载',hashes:['c'.repeat(32)]}}}
cache.read('/fixture','key','room',{...row,type:43},loadMissing,1000)
cache.read('/fixture','key','room',{...row,type:43},loadMissing,1100);assert.equal(missing,1)
cache.read('/fixture','key','room',{...row,type:43},loadMissing,6001);assert.equal(missing,2,'缺失资源需要继续重试')
const base=mkdtempSync(join(tmpdir(),'wetrace-sync-budget-'))
try {
  configureConversationCachePolicy(join(base,'policy'))
  const messages=Array.from({length:5},(_,i)=>({id:String(i),at:1000,type:43,sender:'成员',text:'[视频]',media:{video:{hashes:[String(i+1).repeat(32)],unavailable:'pending'}}}))
  const state={rooms:[{id:'fixture@chatroom',name:'测试群',enabled:false,startedAt:1000,messages}],events:[]}
  const visited=[];let ticks=0
  for(let i=0;i<5;i++)recoverCapturedAttachments(state,join(base,'account'),'key',hash=>{visited.push(hash);return undefined},{budgetMs:15,now:()=>ticks+=10})
  assert.equal(new Set(visited).size,5,'补取分批轮转，不能反复卡在最前面的缺失视频')
  assert.equal(visited.length,5,'预算达到后应停止本轮媒体补取')
} finally {rmSync(base,{recursive:true,force:true})}
// Exercise the actual profile method while substituting native I/O.
const wcdb=readFileSync('src/main/wcdb4-client.ts','utf8'),begin=wcdb.indexOf('  getProfiles('),end=wcdb.indexOf('\n  getSelfProfile',begin)
const calls=[];let now=100000
const native={getDisplayNames:(_handle,ids)=>{calls.push(['names',JSON.parse(ids)]);return Object.fromEntries(JSON.parse(ids).map(id=>[id,'昵称-'+id]))},getHeadImageBuffers:(_handle,ids)=>{calls.push(['buffers',JSON.parse(ids)]);return {}},getAvatarUrls:(_handle,ids)=>{calls.push(['avatars',JSON.parse(ids)]);return Object.fromEntries(JSON.parse(ids).map(id=>[id,'avatar-'+id]))}}
const context={bindings:()=>native,readStringMap:value=>new Map(Object.entries(value)),avatarHexToDataUrl:value=>value,Date:{now:()=>now}}
vm.runInNewContext(stripTypeScriptTypes('class Profiles { profiles=new Map(); callJson(callback){return callback(1,[])}\n'+wcdb.slice(begin,end)+'}\nglobalThis.profile=new Profiles()'),context)
assert.equal(context.profile.getProfiles(['alice']).get('alice').avatar,'avatar-alice')
context.profile.getProfiles(['alice']);assert.equal(calls.length,3,'短时间同步不能重复读取昵称和头像')
context.profile.getProfiles(['alice','bob']);assert.ok(calls.slice(3).every(([,ids])=>ids.length===1&&ids[0]==='bob'))
now+=60001;context.profile.getProfiles(['alice']);assert.equal(calls.length,9,'资料缓存到期后仍会刷新')
console.log('同步延迟回归通过：重复媒体读取消除、内容与账号隔离、附件变更失效、缺失重试、补取限额与轮转、头像资料复用及到期刷新。')
