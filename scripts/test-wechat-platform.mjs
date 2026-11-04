import assert from 'node:assert/strict'
import { defaultWechatRoot, wechatPlatformSupport } from '../src/main/wechat-platform.ts'
assert.equal(defaultWechatRoot('darwin','/mock/home'),'/mock/home/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files')
assert.equal(defaultWechatRoot('win32','C:\\MockUser'),'C:\\MockUser\\Documents\\xwechat_files')
for (const arch of ['arm64','x64']) assert.equal(wechatPlatformSupport('darwin',arch).supported,true)
assert.equal(wechatPlatformSupport('darwin','ia32').supported,false)
assert.match(wechatPlatformSupport('win32','x64').error,/DLL.*密钥.*基线/)
assert.equal(wechatPlatformSupport('linux','x64').supported,false)
console.log('平台边界测试通过：路径分离、不支持环境明确提示，Windows不误报支持')
