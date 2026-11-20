export const personProfileTaskTitle = '画像生成'

export interface ProcessingTask {
  id: number
  title: string
  subject?: string
  subjectKey?: string
  startedAt: number
  finishedAt?: number
  retryable?: boolean
  cancellable?: boolean
  cancelling?: boolean
  state: 'running' | 'done' | 'failed' | 'cancelled'
  detail?: string
  percent?: number
}
