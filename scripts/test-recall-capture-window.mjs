import assert from 'node:assert/strict'
import { recallCaptureWindow } from '../src/main/recall-capture-window.ts'
const all=Array.from({length:9000},(_,i)=>({createTime:10000-i,id:String(i)}))
let pages=0
const read=(limit,offset)=>{pages++;return all.slice(offset,offset+limit)}
assert.equal(recallCaptureWindow(read).rows.length,60)
const increment=recallCaptureWindow(read,9900000)
assert.equal(increment.truncated,false)
assert.ok(increment.rows.length>60)
assert.ok(increment.rows.length<9000)
assert.equal(recallCaptureWindow(read,1).rows.length,5000)
assert.equal(recallCaptureWindow(read,1).truncated,true)
console.log('撤回增量捕获窗口通过：冷启动限量、增量覆盖、重叠区间、5000条上限与缺口标记')
