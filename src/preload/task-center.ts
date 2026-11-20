import { ipcRenderer } from 'electron'
import type { ProcessingTask } from '../shared/task-center'
import type { AiChatProgress } from '../shared/ai-chat'
import type { ReportProgress, VoiceModelStatus } from '../shared/types'

const tasks = new Map<number, ProcessingTask>()
const cancellations = new Map<number, () => Promise<unknown>>()
const retries = new Map<number, () => Promise<unknown>>()
const listeners = new Set<(tasks: ProcessingTask[]) => void>()
let nextId = 0

function publish() {
  const snapshot = [...tasks.values()].reverse()
  for (const listener of listeners) listener(snapshot)
}

export function onProcessingTasks(listener: (tasks: ProcessingTask[]) => void): () => void {
  listeners.add(listener)
  listener([...tasks.values()].reverse())
  return () => { listeners.delete(listener) }
}

export async function cancelProcessingTask(id: number): Promise<void> {
  const task = tasks.get(id)
  const cancel = cancellations.get(id)
  if (!task || task.state !== 'running' || task.cancelling || !cancel) return
  task.cancelling = true
  publish()
  try { await cancel() }
  catch {
    if (task.state === 'running') {
      task.cancelling = false
      task.detail = '取消失败，可重试'
      publish()
    }
  }
}

export async function retryProcessingTask(id: number): Promise<void> {
  const task = tasks.get(id)
  const retry = retries.get(id)
  if (!task?.retryable || !retry) return
  if (task.subjectKey && [...tasks.values()].some(item =>
    item.title === task.title && item.subjectKey === task.subjectKey && item.state === 'running')) return
  retries.delete(id)
  task.retryable = false
  publish()
  try { await retry() }
  catch { /* The new task records its own failure. */ }
}

type TaskProgress<T> = [string, (value: T) => Pick<ProcessingTask, 'detail' | 'percent'> | undefined]

export async function trackTask<T extends { ok?: boolean; success?: boolean; cancelled?: boolean; error?: string }, P>(
  title: string,
  run: () => Promise<T>,
  options: {
    subject?: string
    subjectKey?: string
    progress?: TaskProgress<P>
    retry?: () => Promise<unknown>
    cancel?: () => Promise<unknown>
  } = {},
): Promise<T> {
  const id = ++nextId
  const task: ProcessingTask = {
    id, title, subject: options.subject, subjectKey: options.subjectKey, startedAt: Date.now(), state: 'running',
  }
  tasks.set(id, task)
  if (options.cancel) {
    task.cancellable = true
    cancellations.set(id, options.cancel)
  }
  publish()
  const progress = options.progress
  const listener = (_event: Electron.IpcRendererEvent, value: P) => {
    const update = progress?.[1](value)
    if (!update) return
    Object.assign(task, update)
    publish()
  }
  if (progress) ipcRenderer.on(progress[0], listener)
  try {
    const result = await run()
    task.state = result.cancelled || result.error === '已停止生成' || result.error === '模型下载已取消' ? 'cancelled'
      : result.ok === false || result.success === false ? 'failed' : 'done'
    if (task.state === 'failed') task.detail = result.error
    return result
  } catch (error) {
    task.state = 'failed'
    task.detail = error instanceof Error ? error.message : undefined
    throw error
  } finally {
    task.finishedAt = Date.now()
    delete task.cancellable
    delete task.cancelling
    cancellations.delete(id)
    if (progress) ipcRenderer.removeListener(progress[0], listener)
    if ((task.state === 'failed' || task.state === 'cancelled') && options.retry) {
      task.retryable = true
      retries.set(id, options.retry)
    }
    const finished = [...tasks.values()].filter(item => item.state !== 'running')
    for (const item of finished.slice(0, Math.max(0, finished.length - 50))) {
      tasks.delete(item.id)
      retries.delete(item.id)
    }
    publish()
  }
}

export function aiTaskProgress(requestId: string): TaskProgress<AiChatProgress> {
  return ['ai:progress', (value: AiChatProgress) => value.requestId === requestId ? { detail: value.detail } : undefined]
}

export function reportTaskProgress(requestId: string): TaskProgress<ReportProgress> {
  return ['report:progress', (value: ReportProgress) => value.requestId === requestId ? { detail: value.detail, percent: value.percent } : undefined]
}

export const downloadTaskProgress = ['voice-model:progress', (value: VoiceModelStatus) => ({
  percent: Math.round(value.progress * 100),
})] satisfies TaskProgress<VoiceModelStatus>
