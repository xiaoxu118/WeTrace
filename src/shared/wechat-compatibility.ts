export interface WechatCompatibility {
  platform: 'darwin' | 'win32'
  architectures: ('arm64' | 'x64')[]
  version: string
  captureProfile: string | null
  databaseSchema: 'wechat4' | null
  validation: 'native-only' | 'pending'
}
/** Entries describe implemented adapters, never an assertion that every feature passed real-device QA. */
export const wechatCompatibility: readonly WechatCompatibility[] = [
  { platform: 'darwin', architectures: ['arm64'], version: '4.1.13', captureProfile: 'wechat-4.1.13', databaseSchema: 'wechat4', validation: 'native-only' },
  { platform: 'darwin', architectures: ['x64'], version: '4.1.13', captureProfile: 'wechat-4.1.13', databaseSchema: 'wechat4', validation: 'pending' },
]
export function resolveWechatCompatibility(platform: string, architecture: string, version: string): WechatCompatibility | undefined {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) return undefined
  return wechatCompatibility.find(item => item.platform === platform && item.architectures.some(arch => arch === architecture) && (version === item.version || version.startsWith(item.version + '.')))
}
