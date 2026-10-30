import assert from 'node:assert/strict'
import { cleanElectronEnvironment } from './electron-environment.mjs'
import { cleanMacLaunchEnvironment } from '../src/main/startup-environment.ts'
const original = { PATH: '/usr/bin', HOME: '/test', ELECTRON_RENDERER_URL: 'http://localhost:5173', DYLD_LIBRARY_PATH: '/opt/homebrew/lib:', DYLD_FALLBACK_LIBRARY_PATH: '/custom/lib', DYLD_INSERT_LIBRARIES: '/custom/hook.dylib' }
const expected = { PATH: '/usr/bin', HOME: '/test', ELECTRON_RENDERER_URL: 'http://localhost:5173' }
assert.deepEqual(cleanElectronEnvironment(original, 'darwin'), expected)
assert.deepEqual(cleanMacLaunchEnvironment(original, 'darwin'), expected)
assert.deepEqual(cleanElectronEnvironment(original, 'linux'), original)
assert.deepEqual(cleanMacLaunchEnvironment(original, 'win32'), original)
assert.equal(original.DYLD_LIBRARY_PATH, '/opt/homebrew/lib:', '不改动终端或调用者环境')
console.log('启动环境测试通过：macOS 清除动态库覆盖，保留业务配置，其他平台不变。')
