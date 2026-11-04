import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AiChatHistoryStore } from '../src/main/ai-chat-history-store.ts'
const directory = await fs.mkdtemp(path.join(os.tmpdir(),'wetrace-ai-history-'))
const chat = {id:'fictional-chat',title:'虚构对话',updatedAt:1,turns:[{role:'user',content:'虚构问题'}],memory:{version:1,scope:'fixture',summary:'虚构记忆',coveredTurns:1,prefixHash:'fixture'}}
try {
  let store=new AiChatHistoryStore(directory)
  const first=await store.load({root:'/fixture-account',legacy:{chats:[chat],activeId:chat.id}})
  assert.deepEqual(first.archive,{chats:[chat],activeId:chat.id})
  const files=await fs.readdir(directory)
  assert.equal(files.length,1)
  const file=path.join(directory,files[0])
  assert.equal((await fs.stat(file)).mode&0o777,0o600)
  assert.ok(!files[0].includes('fixture-account'),'account paths are not used as filenames')
  // Recreate the service: browser storage and the previous process are not involved.
  store=new AiChatHistoryStore(directory)
  assert.deepEqual((await store.load({root:'/fixture-account'})).archive,first.archive)
  assert.deepEqual((await store.load({root:'/different-account'})).archive.chats,[])
  let revision=await store.save({root:'/fixture-account',archive:{chats:[],activeId:null},revision:first.revision})
  assert.deepEqual((await store.load({root:'/fixture-account',legacy:first.archive})).archive.chats,[],'deleted chats are not resurrected by stale localStorage migration')
  const other=await store.load({root:'/different-account'})
  await assert.rejects(store.save({root:'/fixture-account',archive:first.archive,revision:first.revision}),/其他窗口更新/)
  assert.deepEqual((await store.load({root:'/different-account'})).archive,other.archive)
  revision=await store.save({root:'/fixture-account',archive:first.archive,revision})
  const outcomes=await Promise.allSettled([store.save({root:'/fixture-account',archive:first.archive,revision}),store.save({root:'/fixture-account',archive:{chats:[],activeId:null},revision})])
  assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1,'stale concurrent snapshot cannot overwrite the winner')
  const valid=await store.load({root:'/fixture-account'})
  await assert.rejects(store.save({root:'/fixture-account',archive:{chats:[{...chat,turns:[{role:'invalid',content:'x'}]}],activeId:null},revision:valid.revision}),/格式无效/)
  assert.deepEqual((await store.load({root:'/fixture-account'})).archive,valid.archive,'invalid input never overwrites disk')
  await fs.writeFile(file,'{broken')
  const recovered=await new AiChatHistoryStore(directory).load({root:'/fixture-account'})
  assert.equal(recovered.archive.chats[0].memory.summary,'虚构记忆','valid backup restores chat and memory')
  await fs.writeFile(`${file}.bak`,'{broken')
  await assert.rejects(new AiChatHistoryStore(directory).load({root:'/fixture-account',legacy:{chats:[],activeId:null}}),/保留原文件/)
  assert.equal(await fs.readFile(file,'utf8'),'{broken','corrupt history is never silently replaced with an empty file')
  assert.ok((await fs.readdir(directory)).every(name=>!name.endsWith('.tmp')))
  console.log('本地对话存储：迁移、重启、账号隔离、删除不复活、版本冲突、备份恢复、损坏保护与权限通过')
} finally {await fs.rm(directory,{recursive:true,force:true})}
