import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { windowsNativeResources } from '../src/main/native-resources.ts'
import { resolveWechatCompatibility } from '../src/shared/wechat-compatibility.ts'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'wetrace-native-'))
try {
 assert.throws(()=>windowsNativeResources([root]),/缺少/)
 const directory=path.join(root,'wcdb','windows','x64');fs.mkdirSync(directory,{recursive:true})
 const files={}
 for(const name of ['wcdb_api.dll','WCDB.dll','key-helper.exe']){const data=Buffer.from('synthetic, never executable: '+name);fs.writeFileSync(path.join(directory,name),data);files[name]=createHash('sha256').update(data).digest('hex')}
 fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({schema:1,versions:['4.1.13.999'],files}))
 assert.equal(windowsNativeResources([root]).api,path.join(directory,'wcdb_api.dll'))
 fs.writeFileSync(path.join(directory,'WCDB.dll'),'damaged');assert.throws(()=>windowsNativeResources([root]),/校验失败/)
 assert.equal(resolveWechatCompatibility('darwin','arm64','4.1.13')?.captureProfile,'wechat-4.1.13')
 assert.equal(resolveWechatCompatibility('darwin','x64','4.1.13.123')?.databaseSchema,'wechat4')
 for(const version of ['4.1.130','4.2.0','unknown','4.1.13;command'])assert.equal(resolveWechatCompatibility('darwin','arm64',version),undefined)
 assert.equal(resolveWechatCompatibility('win32','x64','4.1.13'),undefined)
 console.log('版本和Windows资源清单测试通过：严格版本匹配、架构隔离、缺失/篡改拒绝；未加载真实DLL')
}finally{fs.rmSync(root,{recursive:true,force:true})}
