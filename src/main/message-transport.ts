import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { MessageTransport } from './scheduled-messages'
import type { SendTask, SendCapability } from '../shared/scheduled-messages'

/** Optional, version-specific send bridge. No WCDB writes and no UI-name-based recipient guessing. */
export class NativeMessageTransport implements MessageTransport {
  private directory: string
  private version: () => Promise<string>
  recipients: MessageTransport['recipients']
  constructor(directory: string, version: () => Promise<string>, recipients: MessageTransport['recipients']) { this.directory = directory; this.version = version; this.recipients = recipients }
  private async bridge(): Promise<string> {
    const directory = path.join(this.directory, process.platform, process.arch)
    const executable = path.join(directory, process.platform === 'win32' ? 'sender.exe' : 'sender')
    let manifest: { protocol: number; versions: string[]; sha256: string }
    try { manifest = JSON.parse(fs.readFileSync(path.join(directory, 'compatibility.json'), 'utf8')) }
    catch { throw new Error('当前平台尚未安装经过版本适配的发送通道') }
    if (manifest.protocol !== 1 || !Array.isArray(manifest.versions) || !manifest.versions.includes(await this.version())) throw new Error('当前微信版本没有对应的发送适配，不能确认或执行任务')
    if (!/^[a-f0-9]{64}$/.test(manifest.sha256) || createHash('sha256').update(fs.readFileSync(executable)).digest('hex') !== manifest.sha256) throw new Error('发送通道校验失败')
    return executable
  }
  async capability(_root: string): Promise<SendCapability> {
    try { await this.bridge(); return { supported: true } }
    catch (error) { return { supported: false, reason: error instanceof Error ? error.message : '发送通道不可用' } }
  }
  async send(root: string, task: Readonly<SendTask>, signal: AbortSignal): Promise<{ taskId: string; recipientId: string; receipt: string }> {
    const executable = await this.bridge()
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const child = spawn(executable, ['send', '--json'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, signal })
      let output = '', oversized = false
      const timer = setTimeout(() => { child.kill(); reject(new Error('发送通道超时，结果未知')) }, 30000)
      child.on('error', () => { clearTimeout(timer); reject(new Error('发送通道执行失败，结果未知')) })
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', chunk => { output += chunk.toString('utf8'); if (output.length > 65536) { oversized = true; child.kill() } })
      child.on('close', code => {
        clearTimeout(timer)
        try {
          const result = JSON.parse(output)
          if (code !== 0 || oversized || result.taskId !== task.id || result.recipientId !== task.recipientId || typeof result.receipt !== 'string' || !result.receipt.trim()) throw new Error('invalid receipt')
          resolve(result)
        } catch { reject(new Error('发送结果无法确认，请在微信中核实')) }
      })
      child.stdin.on('error', () => {})
      child.stdin.end(JSON.stringify({ protocol: 1, accountRoot: root, taskId: task.id, recipientId: task.recipientId, content: task.content }))
    })
  }
}
