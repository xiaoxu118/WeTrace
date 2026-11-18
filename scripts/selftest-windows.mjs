// Native ABI only; never opens a WeChat database or captures a key.
import assert from 'node:assert/strict'
import koffi from 'koffi'
import { windowsNativeResources } from '../src/main/native-resources.ts'
import { WindowsWcdbDatabase } from '../src/main/windows-wcdb.ts'
assert.equal(process.platform,'win32','Windows原生自测须在Windows运行')
assert.equal(process.arch,'x64','Windows原生自测仅面向x64')
const resources=windowsNativeResources()
new WindowsWcdbDatabase(resources.dependency)
const key = koffi.load(resources.keyDll)
for (const signature of ['bool InitializeHook(uint32 targetPid)', 'bool PollKeyData(_Out_ char* keyBuffer, int bufferSize)', 'bool CleanupHook()']) assert.equal(typeof key.func(signature), 'function')
console.log('Windows x64资源校验、WCDB公开接口及密钥DLL导出自测通过；未连接微信或调用密钥Hook')
