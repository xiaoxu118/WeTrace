// 本地自测：加载 WCDB 原生桥接并验证初始化和所需导出，不读取微信数据。
// 用法：pnpm test:local

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import koffi from 'koffi';

assert.equal(process.platform, 'darwin', '当前原生自测仅支持 macOS');
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
assert.ok(process.arch === 'arm64' || process.arch === 'x64', `不支持的架构：${process.arch}`);

const libDir = path.resolve('resources', 'wcdb', 'macos', arch);
const wcdbPath = path.join(libDir, 'libWCDB.dylib');
const apiPath = path.join(libDir, 'libwcdb_api.dylib');
assert.ok(fs.existsSync(wcdbPath), `缺少 ${wcdbPath}`);
assert.ok(fs.existsSync(apiPath), `缺少 ${apiPath}`);

koffi.load(wcdbPath);
const api = koffi.load(apiPath);
const initProtection = api.func('int32 InitProtection(const char* resourcePath)');
const resourceRoots = [libDir, path.dirname(libDir), path.resolve('resources')];
let protectionCode = -1;
for (const root of resourceRoots) {
  protectionCode = Number(initProtection(root));
  if (protectionCode === 0) break;
}
assert.equal(protectionCode, 0, `InitProtection 失败：${protectionCode}`);

const initCode = Number(api.func('int32 wcdb_init()')());
assert.ok(initCode === 0 || initCode === -1006, `wcdb_init 失败：${initCode}`);

for (const signature of [
  'int32 wcdb_open_account(const char* path, const char* key, _Out_ int64* handle)',
  'int32 wcdb_get_sessions(int64 handle, _Out_ void** outJson)',
  'int32 wcdb_get_messages(int64 handle, const char* username, int32 limit, int32 offset, _Out_ void** outJson)',
  'int32 wcdb_get_message_table_stats(int64 handle, const char* sessionId, _Out_ void** outJson)',
  'int32 wcdb_exec_query(int64 handle, const char* kind, const char* path, const char* sql, _Out_ void** outJson)',
  'int32 wcdb_get_display_names(int64 handle, const char* usernamesJson, _Out_ void** outJson)',
  'int32 wcdb_get_avatar_urls(int64 handle, const char* usernamesJson, _Out_ void** outJson)',
  'int32 wcdb_get_head_image_buffers(int64 handle, const char* usernamesJson, _Out_ void** outJson)',
  'void wcdb_free_string(void* ptr)',
]) {
  assert.equal(typeof api.func(signature), 'function', `缺少原生接口：${signature}`);
}

console.log(`自测通过：${arch} WCDB 加载、InitProtection、wcdb_init 和核心 ABI 均正常。`);
