import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { SendTask, SendTaskState, SendTaskAction, SendCapability } from '../shared/scheduled-messages'
export interface MessageTransport {
  capability(root: string): Promise<SendCapability>
  recipients(root: string): Promise<{ id: string; name: string }[]>
  send(root: string, task: Readonly<SendTask>, signal: AbortSignal): Promise<{ taskId: string; recipientId: string; receipt: string }>
}
/** Separate from WCDB; persisted before dispatch. An uncertain result is never retried automatically. */
export class ScheduledMessages {
  private directory: string
  private transport: MessageTransport
  private encrypt: (value: string) => Buffer
  private decrypt: (value: Buffer) => string
  private clock: () => number
  private accounts = new Map<string, SendTaskState>()
  private active = new Map<string, AbortController>()
  private queues = new Map<string, Promise<unknown>>()
  constructor(directory: string, transport: MessageTransport, encrypt: (value: string) => Buffer, decrypt: (value: Buffer) => string, clock = Date.now) {
    this.directory = directory; this.transport = transport; this.encrypt = encrypt; this.decrypt = decrypt; this.clock = clock
  }
  private file(root: string): string {
    if (typeof root !== 'string' || !root.trim()) throw new Error('请先连接微信账号')
    return path.join(this.directory, createHash('sha256').update(root).digest('hex') + '.bin')
  }
  private load(root: string): SendTaskState {
    const file = this.file(root)
    const cached = this.accounts.get(root)
    if (cached) return cached
    let state: SendTaskState = { enabled: false, tasks: [] }
    try {
      state = JSON.parse(this.decrypt(fs.readFileSync(file)))
      if (!state || typeof state.enabled !== 'boolean' || !Array.isArray(state.tasks) || state.tasks.some(task => !task || typeof task.id !== 'string' || typeof task.content !== 'string' || !Array.isArray(task.logs) || !['draft','scheduled','paused','sending','sent','failed','unknown','cancelled'].includes(task.status))) throw new Error('invalid task store')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法读取发送任务，已保留原文件') }
    for (const task of state.tasks) if (task.status === 'sending') { task.status = 'unknown'; this.log(task, '应用在发送期间退出，结果未知；请在微信核实，不会自动重试') }
    this.save(root, state); this.accounts.set(root, state)
    return state
  }
  private save(root: string, state: SendTaskState): void {
    const file = this.file(root)
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const temp = file + '.' + randomUUID() + '.tmp'
    try { fs.writeFileSync(temp, this.encrypt(JSON.stringify(state)), { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file) }
    finally { fs.rmSync(temp, { force: true }) }
  }
  private log(task: SendTask, detail: string): void { task.updatedAt = this.clock(); task.logs.push({ at: task.updatedAt, detail }); task.logs = task.logs.slice(-100) }
  private async exclusive<T>(root: string, run: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(root) ?? Promise.resolve()).catch(() => undefined).then(run)
    this.queues.set(root, next)
    try { return await next } finally { if (this.queues.get(root) === next) this.queues.delete(root) }
  }
  async update(root: string, action: SendTaskAction): Promise<{ state: SendTaskState; capability: SendCapability }> {
    return this.exclusive(root, async () => {
      const state = structuredClone(this.load(root))
      const capability = await this.transport.capability(root)
      if (!action || typeof action.type !== 'string') throw new Error('发送任务操作无效')
      if (action.type === 'create') {
        if (typeof action.content !== 'string' || !action.content.trim() || action.content.length > 4000 || !Number.isFinite(action.dueAt) || !Number.isFinite(new Date(action.dueAt).getTime()) || action.dueAt <= this.clock()) throw new Error('请输入1至4000字内容并选择未来时间')
        if (state.tasks.length >= 500) throw new Error('发送任务已达500条上限')
        const recipient = (await this.transport.recipients(root)).find(item => item.id === action.recipientId)
        if (!recipient) throw new Error('接收方已不可用，请重新选择')
        const now = this.clock()
        state.tasks.unshift({ id: randomUUID(), recipientId: recipient.id, recipientName: recipient.name, content: action.content, dueAt: action.dueAt, status: 'draft', createdAt: now, updatedAt: now, logs: [{ at: now, detail: '任务已创建，尚未确认，不会发送' }] })
      } else if (action.type === 'enable') {
        if (typeof action.enabled !== 'boolean') throw new Error('发送开关无效')
        if (action.enabled && !capability.supported) throw new Error(capability.reason || '当前微信版本不支持发送')
        state.enabled = action.enabled
        if (!state.enabled) for (const task of state.tasks) if (task.status === 'scheduled') { task.status = 'paused'; this.log(task, '发送功能已关闭，任务已暂停') }
      } else if (action.type !== 'load') {
        const task = state.tasks.find(task => task.id === action.id)
        if (!task) throw new Error('发送任务不存在')
        if (action.type === 'confirm' || action.type === 'resume') {
          if (!state.enabled || !capability.supported) throw new Error(capability.reason || '请先开启发送功能')
          if (!(action.type === 'confirm' ? task.status === 'draft' : task.status === 'paused') || task.dueAt <= this.clock()) throw new Error('任务状态或执行时间已失效，请重新创建')
          if (!(await this.transport.recipients(root)).some(item => item.id === task.recipientId)) throw new Error('接收方已不可用')
          task.status = 'scheduled'; this.log(task, '用户已确认接收方、内容与时间，等待执行')
        } else if (action.type === 'pause' || action.type === 'cancel') {
          if (!['draft', 'scheduled', 'paused'].includes(task.status)) throw new Error('任务已开始或结束，不能更改；发送结果请查看日志')
          task.status = action.type === 'pause' ? 'paused' : 'cancelled'; this.log(task, action.type === 'pause' ? '用户暂停任务' : '用户取消任务')
        } else throw new Error('发送任务操作无效')
      }
      this.save(root, state); this.accounts.set(root, state)
      return { state: structuredClone(state), capability }
    })
  }
  async tick(root: string): Promise<void> {
    if (this.active.has(root)) return
    const controller = new AbortController()
    this.active.set(root, controller)
    try {
      const task = await this.exclusive(root, async () => {
        const state = structuredClone(this.load(root))
        if (!state.enabled) return undefined
        const task = state.tasks.find(item => item.status === 'scheduled' && item.dueAt <= this.clock())
        if (!task) return undefined
        if (this.clock() - task.dueAt > 5 * 60_000) { task.status = 'paused'; this.log(task, '任务已错过执行时间超过5分钟，已暂停；请核实后重新创建'); this.save(root, state); this.accounts.set(root, state); return undefined }
        const capability = await this.transport.capability(root)
        if (!capability.supported || !(await this.transport.recipients(root)).some(item => item.id === task.recipientId)) {
          task.status = 'failed'; this.log(task, capability.reason || '接收方已不可用，未执行发送')
          this.save(root, state); this.accounts.set(root, state); return undefined
        }
        task.status = 'sending'; this.log(task, '开始发送；异常结果不会自动重试')
        this.save(root, state); this.accounts.set(root, state)
        return structuredClone(task)
      })
      if (!task) return
      let receipt: string | undefined, detail = '发送结果未知，请在微信核实；不会自动重试'
      try {
        const result = await this.transport.send(root, task, controller.signal)
        if (result.taskId === task.id && result.recipientId === task.recipientId && typeof result.receipt === 'string' && result.receipt.trim()) receipt = result.receipt
      } catch { /* A transport error after dispatch is ambiguous, never silently repeat it. */ }
      await this.exclusive(root, async () => {
        const state = structuredClone(this.load(root)), stored = state.tasks.find(item => item.id === task.id)!
        stored.status = receipt ? 'sent' : 'unknown'; stored.receipt = receipt
        this.log(stored, receipt ? '发送通道已确认送达' : detail)
        this.save(root, state); this.accounts.set(root, state)
      })
    } finally { this.active.delete(root) }
  }
  stop(): void { for (const controller of this.active.values()) controller.abort() }
}
