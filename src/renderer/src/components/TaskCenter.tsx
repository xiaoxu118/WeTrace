import { Badge, Button, Card, Drawer, Empty, Progress, Space, Tag, Typography } from 'antd'
import { ListTodo } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ProcessingTask } from '../../../shared/task-center'

const labels = { running: '处理中', done: '已完成', failed: '失败', cancelled: '已取消' }
const colors = { running: 'processing', done: 'success', failed: 'error', cancelled: 'default' }

function formatElapsed(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const seconds = total % 60
  return [hours && `${hours} 小时`, minutes && `${minutes} 分钟`, seconds && `${seconds} 秒`]
    .filter(Boolean).join(' ') || '0 秒'
}

export function TaskCenter() {
  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState<ProcessingTask[]>([])
  const [now, setNow] = useState(Date.now)
  useEffect(() => window.wetrace.onProcessingTasks?.(setTasks), [])

  const running = tasks.filter(task => task.state === 'running')
  const finished = tasks.filter(task => task.state !== 'running')
  const hasRunningTasks = running.length > 0
  useEffect(() => {
    if (!open || !hasRunningTasks) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [open, hasRunningTasks])

  return <>
      <Button
        type="text"
        className="rbtn"
        aria-label={running.length ? `任务中心，${running.length} 项处理中` : '任务中心'}
        aria-expanded={open}
        onClick={() => { setNow(Date.now()); setOpen(current => !current) }}
        icon={<Badge dot={running.length > 0}><ListTodo size={19} strokeWidth={1.7} /></Badge>}
      >任务中心</Button>
    <Drawer title="任务中心" open={open} mask={false} aria-modal={false} onClose={() => setOpen(false)}>
      {tasks.length === 0 ? <Empty description="暂无任务" /> :
        <Space orientation="vertical" size="small" style={{ width: '100%' }}>
          {[...running, ...finished].map(task => (
            <Card key={task.id} size="small" title={task.title}
              extra={<Tag color={colors[task.state]}>{labels[task.state]}</Tag>}>
              <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                {task.subject && <Typography.Text>{task.subject}</Typography.Text>}
                <Typography.Text type="secondary">{new Date(task.startedAt).toLocaleString('zh-CN')}</Typography.Text>
                {(task.state === 'running' || task.finishedAt !== undefined) && (
                  <Typography.Text type="secondary">
                    {task.state === 'running' ? '已用时' : '总用时'} {formatElapsed((task.finishedAt ?? now) - task.startedAt)}
                  </Typography.Text>
                )}
                {task.detail && (task.state === 'running' || task.state === 'failed') &&
                  <Typography.Text type={task.state === 'failed' ? 'danger' : undefined}>{task.detail}</Typography.Text>}
                {task.state === 'running' && task.cancellable && (
                  <Button size="small" loading={task.cancelling} onClick={() => void window.wetrace.cancelProcessingTask(task.id)}>
                    {task.cancelling ? '取消中…' : '取消'}
                  </Button>
                )}
                {task.retryable && (
                  <Button size="small"
                    disabled={Boolean(task.subjectKey && running.some(item => item.title === task.title && item.subjectKey === task.subjectKey))}
                    onClick={() => void window.wetrace.retryProcessingTask(task.id)}>
                    {task.state === 'cancelled' ? '继续' : '重试'}
                  </Button>
                )}
                {task.percent !== undefined && task.state === 'running' && <Progress percent={task.percent} />}
              </Space>
            </Card>
          ))}
        </Space>}
    </Drawer>
  </>
}
