// Concurrent synthetic writes only: no WeChat database, real messages or keys.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fsSync from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { loadMonitor, monitorFile, updateMonitorForSync } from '../src/main/group-monitor.ts'
const directory = await fs.mkdtemp(path.join(os.tmpdir(),'wetrace-monitor-race-'))
const root='/fictional-account', key='fictional-key'
try {
  const source=`import {saveMonitor} from ${JSON.stringify(pathToFileURL(path.resolve('src/main/group-monitor.ts')).href)};
    for(let i=0;i<120;i++)saveMonitor(process.argv[1],'/fictional-account','fictional-key',{rooms:[],events:[]});`
  await Promise.all(Array.from({length:6},()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',source,directory],{stdio:['ignore','ignore','pipe']})
    let error=''
    child.stderr.on('data',chunk=>{error+=chunk})
    child.on('error',reject)
    child.on('exit',code=>code===0?resolve():reject(new Error(error)))
  })))
  assert.deepEqual(loadMonitor(directory,root,key),{rooms:[],events:[]})
  assert.equal((await fs.stat(monitorFile(directory,root))).mode&0o777,0o600)
  assert.ok((await fs.readdir(directory)).every(file=>!file.endsWith('.tmp')))
  const before=await fs.readFile(monitorFile(directory,root))
  const warning=updateMonitorForSync(directory,root,key,()=>{throw new Error('模拟失败')})
  assert.match(warning,/聊天记录已正常读取/)
  assert.deepEqual(await fs.readFile(monitorFile(directory,root)),before,'a failed update must not overwrite existing state')
  const blocker=path.join(directory,'blocked');await fs.writeFile(blocker,'fixture')
  assert.match(updateMonitorForSync(blocker,root,key,()=>{}),/暂不可用/,'filesystem errors become nonfatal warnings')
  const rename = fsSync.renameSync
  try {
    fsSync.renameSync = () => { throw Object.assign(new Error('模拟临时文件被移走'),{code:'ENOENT'}) }
    syncBuiltinESMExports()
    assert.match(updateMonitorForSync(directory,root,key,()=>{}),/聊天记录已正常读取/,'the reported rename ENOENT must not block sync')
  } finally {fsSync.renameSync=rename;syncBuiltinESMExports()}
  assert.deepEqual(await fs.readFile(monitorFile(directory,root)),before)
  assert.ok((await fs.readdir(directory)).every(file=>!file.endsWith('.tmp')))
  assert.equal(updateMonitorForSync(directory,root,key,()=>{}),undefined)
  console.log('群监控持久化：6进程720次并发写入、加密文件可读、临时文件清理、权限和非阻断失败通过')
} finally {await fs.rm(directory,{recursive:true,force:true})}
