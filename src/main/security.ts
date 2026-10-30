import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

const CSRUTIL = '/usr/bin/csrutil'
const PGREP = '/usr/bin/pgrep'
const LSOF = '/usr/sbin/lsof'

export async function sipEnabled(): Promise<boolean> {
  try {
    const { stdout } = await run(CSRUTIL, ['status'])
    return !/disabled/i.test(stdout)
  } catch {
    return true
  }
}

async function wechatPid(): Promise<string | null> {
  try {
    const { stdout } = await run(PGREP, ['-x', 'WeChat'])
    const pid = stdout.trim().split('\n')[0]
    return pid || null
  } catch {
    return null
  }
}

export async function wechatRunning(): Promise<boolean> {
  return (await wechatPid()) !== null
}

// 微信登录后会打开消息数据库；未登录时不会持有这些文件。
export async function wechatProcess(): Promise<{ running: boolean; loggedIn: boolean }> {
  const pid = await wechatPid()
  if (!pid) return { running: false, loggedIn: false }

  try {
    const { stdout } = await run(LSOF, ['-p', pid, '-Fn'], { maxBuffer: 8 << 20 })
    return { running: true, loggedIn: /db_storage\/message\/message_0\.db/.test(stdout) }
  } catch {
    return { running: true, loggedIn: false }
  }
}
