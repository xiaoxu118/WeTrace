// Native ABI only; never opens a WeChat database or captures a key.
import assert from 'node:assert/strict'
import path from 'node:path'
import koffi from 'koffi'
import { windowsNativeResources } from '../src/main/native-resources.ts'
assert.equal(process.platform,'win32','Windows原生自测须在Windows运行')
assert.equal(process.arch,'x64','Windows原生自测仅面向x64')
const resources=windowsNativeResources()
koffi.load(resources.dependency)
const api=koffi.load(resources.api)
const protection=api.func('int32 InitProtection(const char* resourcePath)')
let code=-1
for(const root of [resources.directory,path.dirname(resources.directory),path.resolve('resources')]){code=Number(protection(root));if(code===0)break}
assert.equal(code,0,'Windows WCDB保护初始化失败')
const init=Number(api.func('int32 wcdb_init()')())
assert.ok(init===0 || init===-1006,`Windows WCDB初始化失败：${init}`)
for(const signature of [
 'int32 wcdb_open_account(const char* path, const char* key, _Out_ int64* handle)',
 'int32 wcdb_get_sessions(int64 handle, _Out_ void** outJson)',
 'int32 wcdb_get_messages(int64 handle, const char* username, int32 limit, int32 offset, _Out_ void** outJson)',
 'int32 wcdb_get_message_table_stats(int64 handle, const char* sessionId, _Out_ void** outJson)',
 'int32 wcdb_exec_query(int64 handle, const char* kind, const char* path, const char* sql, _Out_ void** outJson)',
 'int32 wcdb_get_display_names(int64 handle, const char* usernamesJson, _Out_ void** outJson)',
 'int32 wcdb_get_avatar_urls(int64 handle, const char* usernamesJson, _Out_ void** outJson)',
 'int32 wcdb_get_head_image_buffers(int64 handle, const char* usernamesJson, _Out_ void** outJson)',
 'void wcdb_free_string(void* ptr)',
]) assert.equal(typeof api.func(signature),'function',`缺少Windows原生接口：${signature}`)
console.log('Windows x64资源校验、DLL加载及核心ABI自测通过；未读取微信数据')
