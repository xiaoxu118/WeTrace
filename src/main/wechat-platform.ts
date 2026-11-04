import { windowsNativeResources } from './native-resources.ts'
import path from 'node:path'
import os from 'node:os'

export function wechatPlatformSupport(platform: string = process.platform, architecture: string = process.arch): { supported: boolean; error?: string } {
  if (platform === 'darwin' && ['arm64', 'x64'].includes(architecture)) return { supported: true }
  if (platform === 'win32' && architecture === 'x64') { try { windowsNativeResources(); return { supported: true } } catch (error) { return { supported: false, error: error instanceof Error ? error.message : 'Windows原生资源不可用' } } }
  return { supported: false, error: `当前系统或架构暂不支持连接微信（${platform} / ${architecture}）` }
}

/** Discovery paths only; their existence does not imply a verified platform or database version. */
export function defaultWechatRoot(platform: string = process.platform, home = os.homedir()): string {
  const paths = platform === 'win32' ? path.win32 : path.posix
  return platform === 'win32'
    ? paths.join(home, 'Documents', 'xwechat_files')
    : paths.join(home, 'Library', 'Containers', 'com.tencent.xinWeChat', 'Data', 'Documents', 'xwechat_files')
}
