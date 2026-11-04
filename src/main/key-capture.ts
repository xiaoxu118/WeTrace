import { windowsNativeResources } from './native-resources'
import { resolveWechatCompatibility } from '../shared/wechat-compatibility'
import { app } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { isValidDatabaseKey } from './database-key-store'

const run = promisify(execFile)

export interface CaptureResult {
  success: boolean
  key?: string
  error?: string
  code?: string
}

function findHelper(name: string): string | null {
  const candidates = [
    path.join(process.resourcesPath, name),
    path.join(app.getAppPath(), 'resources', name),
    path.join(process.cwd(), 'resources', name),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

export async function wechatVersion(): Promise<string> {
  if (process.platform === 'win32') {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$p = Get-Process -Name Weixin,WeChat -ErrorAction SilentlyContinue | Select-Object -First 1; if (!$p) { exit 1 }; (Get-Item -LiteralPath $p.Path).VersionInfo.FileVersion"], { timeout: 10000, windowsHide: true })
    return stdout.trim()
  }
  const { stdout } = await run('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleShortVersionString',
    '/Applications/WeChat.app/Contents/Info.plist',
  ])
  return stdout.trim()
}

async function wechatPid(): Promise<number> {
  const { stdout } = await run('/usr/bin/pgrep', ['-x', 'WeChat'])
  const pids = stdout
    .split(/\r?\n/)
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item) && item > 0)
  if (!pids.length) throw new Error('未找到微信主进程')
  return Math.max(...pids)
}

function parseOutput(output: string): CaptureResult {
  const payloads: Record<string, unknown>[] = []
  for (const match of output.matchAll(/\{[^{}]*\}/g)) {
    try {
      payloads.push(JSON.parse(match[0]) as Record<string, unknown>)
    } catch {
      // 忽略 helper 的非 JSON 进度输出。
    }
  }
  const success = payloads.find((item) => item.success === true && typeof item.key === 'string')
  const key = typeof success?.key === 'string' ? success.key.trim().replace(/^0x/i, '') : ''
  if (isValidDatabaseKey(key)) return { success: true, key: key.toLowerCase() }

  const failure = payloads.find((item) => typeof item.result === 'string')
  const result = typeof failure?.result === 'string' ? failure.result : output
  const code = result.match(/ERROR:([^:\s"}]+)/i)?.[1]?.toUpperCase() || 'CAPTURE_FAILED'
  const messages: Record<string, string> = {
    CAPTURE_TIMEOUT: '等待登录超时，未捕获到数据库原始密钥。',
    SCAN_FAILED: '内存扫描失败，当前微信版本或运行状态暂未适配。',
    PERMISSION_DENIED: '管理员授权不足，无法读取微信进程内存。',
  }
  return { success: false, code, error: messages[code] || '密钥工具未返回有效结果，请确认微信仍在登录页面后重试。' }
}

export async function captureAccountKey(onReady?: () => void, accountRoot?: string): Promise<CaptureResult> {
  if (process.platform === 'win32' && process.arch === 'x64') {
    try {
      const resources = windowsNativeResources()
      const version = await wechatVersion()
      if (!resources.versions.includes(version)) return { success: false, code: 'UNSUPPORTED_VERSION', error: `当前微信版本 ${version} 未在Windows适配清单中` }
      if (!accountRoot) throw new Error('缺少账号目录')
      onReady?.()
      const { stdout } = await run(resources.keyHelper, ['capture', '--account-root', accountRoot, '--json'], { timeout: 135000, maxBuffer: 2 << 20, windowsHide: true })
      return parseOutput(stdout)
    } catch { return { success: false, code: 'WINDOWS_CAPTURE_FAILED', error: 'Windows密钥工具不可用或执行失败，未保存密钥' } }
  }
  if (process.platform !== 'darwin') {
    return { success: false, code: 'UNSUPPORTED_PLATFORM', error: '自动获取密钥目前仅支持 macOS。' }
  }
  try {
    const [version, pid] = await Promise.all([wechatVersion(), wechatPid()])
    const compatibility = resolveWechatCompatibility(process.platform, process.arch, version)
    if (!compatibility?.captureProfile) return { success: false, code: 'UNSUPPORTED_VERSION', error: `当前微信版本 ${version} 尚未适配密钥获取，未尝试其他版本的工具。` }
    const current = compatibility.captureProfile === 'wechat-4.1.13'
    const helperName = current ? 'xkey_helper_4_1_13' : 'xkey_helper'
    const helper = findHelper(helperName)
    if (!helper) return { success: false, code: 'HELPER_MISSING', error: `缺少 ${helperName} 取 key 组件。` }

    const waitMs = current ? 120_000 : 60_000
    const timeoutSeconds = current ? 130 : 90
    const args = current
      ? [String(pid), String(waitMs), '--profile', 'wechat-4.1.13', '--account']
      : [String(pid), String(waitMs)]
    const script = [
      `set helperPath to ${JSON.stringify(helper)}`,
      `set commandText to quoted form of helperPath & " ${args.join(' ')}"`,
      `set timeoutSec to ${timeoutSeconds}`,
      'try',
      'with timeout of timeoutSec seconds',
      'set outText to do shell script commandText with administrator privileges',
      'end timeout',
      'return "OK::" & outText',
      'on error errMsg number errNum',
      'return "ERR::" & errNum & "::" & errMsg',
      'end try',
    ]
    onReady?.()
    const { stdout } = await run('/usr/bin/osascript', script.flatMap((line) => ['-e', line]), {
      timeout: current ? 135_000 : 100_000,
      maxBuffer: 2 << 20,
    })
    const output = stdout.trim()
    if (output.startsWith('ERR::-128')) {
      return { success: false, code: 'AUTH_CANCELED', error: '已取消管理员授权。' }
    }
    if (output.startsWith('ERR::')) return parseOutput(output)
    return parseOutput(output.startsWith('OK::') ? output.slice(4) : output)
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { killed?: boolean }
    if (failure.message.includes('未找到微信主进程')) {
      return { success: false, code: 'WECHAT_NOT_RUNNING', error: '未找到微信主进程，请先启动微信并停留在登录页面。' }
    }
    if (failure.killed || failure.code === 'ETIMEDOUT') {
      return { success: false, code: 'CAPTURE_TIMEOUT', error: '等待登录或管理员授权超时，请重试。' }
    }
    return { success: false, code: 'HELPER_EXEC_FAILED', error: '密钥工具执行失败，请确认微信仍在运行后重试。' }
  }
}
