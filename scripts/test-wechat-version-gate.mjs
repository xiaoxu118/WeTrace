// Synthetic account directory and mocked native calls; no real database is read.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wetrace-version-'))
const account=path.join(directory,'wxid_fictional_account')
fs.mkdirSync(path.join(account,'db_storage','session'),{recursive:true})
fs.writeFileSync(path.join(account,'db_storage','session','session.db'),'synthetic fixture, not a database')
let version='4.2.0',reads=0,validations=0
const url=source=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64')
const compatibility=await import(url(fs.readFileSync('src/shared/wechat-compatibility.ts','utf8')))
globalThis.versionFixture={
 windowsNativeResources:()=>({versions:['4.1.13']}),
 app:{getPath:()=>directory}, defaultWechatRoot:()=>directory,wechatPlatformSupport:()=>({supported:true}),
 resolveWechatCompatibility:compatibility.resolveWechatCompatibility,
 wechatVersion:async()=>{if(!version)throw new Error('fixture missing version');return version},
 loadDatabaseKey:()=>{reads++;return{key:'a'.repeat(64),legacy:false,createdAt:null}},
 validateWechatDatabase:async()=>{validations++},
}
let source=stripTypeScriptTypes(fs.readFileSync('src/main/wechat.ts','utf8'))
source=source.replace(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g,(match,names,specifier)=>specifier.startsWith('node:')?match:`const {${names}} = globalThis.versionFixture`)
try{
 const {detectWechat,syncWechat}=await import(url(source))
 let result=await detectWechat(account)
 assert.equal(result.hasKey,false);assert.match(result.error,/尚未适配/);assert.equal(reads,0)
 await assert.rejects(syncWechat({root:account}),/尚未适配/);assert.equal(reads,0)
 version='4.1.13';result=await detectWechat(account)
 assert.equal(result.hasKey,true);assert.equal(validations,1)
 version='';result=await detectWechat(account);assert.equal(result.hasKey,false);assert.match(result.error,/无法确定/)
 console.log('版本连接门禁通过：未知版本和版本读取失败不误报连接成功、不读取密钥；已适配版本仍走数据库校验')
}finally{delete globalThis.versionFixture;fs.rmSync(directory,{recursive:true,force:true})}
