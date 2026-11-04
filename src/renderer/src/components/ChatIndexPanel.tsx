import { Alert, Button, Card, Collapse, Empty, Flex, Input, Progress, Statistic, Tag, Typography } from 'antd'
import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChatIndexAction, ChatIndexStatus } from '../../../shared/chat-index'

const INDEX_UPDATE_INTERVAL = 30 * 60 * 1000

export function useChatIndex(root?: string) {
  const [status, setStatus] = useState<ChatIndexStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const activeRoot = useRef(root)
  activeRoot.current = root
  const statusRef = useRef(status)
  statusRef.current = status
  const exclusionQueue = useRef<Promise<void>>(Promise.resolve())
  const pendingRef = useRef(new Set<string>())
  const [pendingExclusions, setPendingExclusions] = useState<string[]>([])
  function setExcluded(room: string, excluded: boolean) {
    if (!root || pendingRef.current.has(room)) return
    const requestRoot = root
    const pending = pendingRef.current
    pending.add(room)
    setPendingExclusions([...pending])
    // Serialize full-list writes, merging each change with the latest confirmed list.
    exclusionQueue.current = exclusionQueue.current.then(async () => {
      if (activeRoot.current !== requestRoot || pendingRef.current !== pending) return
      try {
        const rooms = new Set(statusRef.current?.excludedConversationIds ?? [])
        if (excluded) rooms.add(room)
        else rooms.delete(room)
        const response = await window.wetrace.controlChatIndex({ root: requestRoot, action: 'exclusions', excludedConversationIds: [...rooms] })
        if (activeRoot.current !== requestRoot || pendingRef.current !== pending) return
        if (!response.ok) throw new Error(response.error)
        statusRef.current = response.data
        setStatus(response.data); setError('')
      } catch (error) {
        if (activeRoot.current === requestRoot && pendingRef.current === pending) setError(error instanceof Error ? error.message : '排除名单保存失败')
      } finally {
        pending.delete(room)
        if (activeRoot.current === requestRoot && pendingRef.current === pending) setPendingExclusions([...pending])
      }
    })
  }
  async function control(action: ChatIndexAction, excludedConversationIds?: string[]) {
    if (!root || busy) return
    setBusy(true)
    try {
      const response = await window.wetrace.controlChatIndex({ root, action, excludedConversationIds })
      if (activeRoot.current !== root) return
      if (!response.ok) throw new Error(response.error)
      setStatus(response.data); setError('')
    } catch (error) { if (activeRoot.current === root) setError(error instanceof Error ? error.message : '索引操作失败') }
    finally { if (activeRoot.current === root) setBusy(false) }
  }
  useEffect(() => {
    setStatus(null); statusRef.current = null; setError(''); setBusy(false)
    pendingRef.current = new Set(); setPendingExclusions([])
    if (!root || !window.wetrace.controlChatIndex) return
    let active = true
    let timer: number | undefined
    let delay = 2000
    async function poll(first = false) {
      try {
        let response = await window.wetrace.controlChatIndex({ root, action: 'status' })
        if (active && first && response.ok && response.data.state !== 'paused' && (response.data.state === 'idle' || response.data.state === 'building' || !response.data.updatedAt || Date.now() - new Date(response.data.updatedAt).getTime() >= INDEX_UPDATE_INTERVAL)) {
          response = await window.wetrace.controlChatIndex({ root, action: 'sync' })
        }
        if (!active) return
        if (response.ok) { if (!pendingRef.current.size) { statusRef.current = response.data; setStatus(response.data) }; setError(''); delay = response.data.state === 'building' ? 2000 : 10000 }
        else setError(response.error)
      } catch (error) { if (active) setError(error instanceof Error ? error.message : '读取索引状态失败') }
      if (active) timer = window.setTimeout(() => void poll(), delay)
    }
    void poll(true)
    // Index updates are independent of the more frequent chat/status refreshes.
    const refresh = window.setInterval(() => { void window.wetrace.controlChatIndex({ root, action: 'sync' }).catch(() => undefined) }, INDEX_UPDATE_INTERVAL)
    return () => { active = false; window.clearTimeout(timer); window.clearInterval(refresh) }
  }, [root])
  return { root, status, error, busy, control, setExcluded, pendingExclusions }
}

export function ChatIndexPanel({ state }: { state: ReturnType<typeof useChatIndex> }) {
  const { root, status, error, busy, control, setExcluded, pendingExclusions } = state
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([])
  const [filter, setFilter] = useState('')
  const [listError, setListError] = useState('')
  const [listLoading, setListLoading] = useState(false)
  useEffect(() => {
    let active = true
    setGroups([]); setListError(''); setFilter(''); setListLoading(Boolean(root))
    if (root) void window.wetrace.listConversationOptions(root).then(response => {
      if (!active) return
      if (response.ok) setGroups(response.conversations.filter(item => item.type === 'group'))
      else setListError(response.error)
    }).catch(error => { if (active) setListError(String(error)) }).finally(() => { if (active) setListLoading(false) })
    return () => { active = false }
  }, [root])
  const excludedIds = status?.excludedConversationIds ?? []
  const excludedGroups = excludedIds.map(id => groups.find(group => group.id === id) ?? { id, name: id })
  const label = status ? { idle: '等待建立', building: '正在建立', paused: '已暂停', ready: '已就绪', error: '部分记录待重试' }[status.state] : '读取中…'
  const percent = status?.totalStores ? Math.round(status.completedStores / status.totalStores * 100) : 0
  const keyword = filter.trim().toLowerCase()
  const searchResults = keyword ? groups.filter(group => !excludedIds.includes(group.id) && `${group.name} ${group.id}`.toLowerCase().includes(keyword)) : []
  return <Card className="chat-index-panel" title="聊天记录索引" extra={<Tag color={status?.state === 'ready' ? 'success' : status?.state === 'building' ? 'processing' : 'default'}>{label}</Tag>}>
    <Typography.Paragraph type="secondary">自动索引排除名单以外的聊天记录，每半小时补充新消息，暂停或退出后可继续。正文加密保存在本机。</Typography.Paragraph>
    <Flex gap={48} wrap className="chat-index-stats">
      <Statistic title="已索引消息" value={status?.messages} formatter={value => status ? Number(value).toLocaleString() : '—'} suffix="条" />
      <Statistic title="已索引会话" value={status?.conversations} formatter={value => status ? Number(value).toLocaleString() : '—'} suffix="个" />
    </Flex>
    {status?.state === 'building' && <Flex vertical gap={4} className="chat-index-progress">
      <Progress percent={percent} status="active" size="small" aria-label="聊天索引进度" />
      <Typography.Text type="secondary">已完成 {status.completedStores}/{status.totalStores} 个消息表</Typography.Text>
    </Flex>}
    <Flex align="center" justify="space-between" gap={12} wrap className="chat-index-toolbar">
      <Typography.Text type="secondary">{status?.updatedAt ? `最近完成：${new Date(status.updatedAt).toLocaleString('zh-CN')}` : '首次建立后可搜索历史聊天记录'}</Typography.Text>
      <Button loading={busy} disabled={!root} onClick={() => void control(status?.state === 'building' ? 'pause' : 'start')}>{status?.state === 'building' ? '暂停建立' : status?.state === 'paused' ? '继续建立' : '更新索引'}</Button>
    </Flex>
    <Collapse className="cache-exclusions" ghost items={[{
      key: 'exclusions',
      label: <Flex align="center" gap={8}><Typography.Text strong>群聊排除名单</Typography.Text><Tag bordered={false}>已排除 {status?.excludedConversationIds?.length ?? 0} 个群</Tag></Flex>,
      children: <Flex vertical gap={16}>
        <Typography.Text type="secondary">搜索会话名称，点击“排除”加入名单并立即生效。</Typography.Text>
        <Input aria-label="搜索排除群聊" placeholder="搜索会话名称以添加排除" prefix={<Search size={15} />} allowClear value={filter} onChange={event => setFilter(event.target.value)} />
        {listError && <Alert type="error" showIcon title="群聊列表读取失败" description={listError} />}
        {keyword && <Card size="small" title="搜索结果" className="cache-exclusion-list cache-exclusion-results" loading={listLoading}>
          {searchResults.length ? searchResults.map(group => <Flex key={group.id} align="center" justify="space-between" gap={12} className="cache-exclusion-row">
            <Flex vertical gap={2} className="cache-exclusion-name">
              <Typography.Text strong>{group.name}</Typography.Text>
              <Typography.Text type="secondary" className="cache-exclusion-id">{group.id}</Typography.Text>
            </Flex>
            <Button size="small" type="primary" loading={pendingExclusions.includes(group.id)} disabled={!status} onClick={() => setExcluded(group.id, true)}>排除</Button>
          </Flex>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到可添加的群聊" />}
        </Card>}
        <Card size="small" title={`已排除的群聊（${excludedIds.length}）`} className="cache-exclusion-list cache-excluded-groups" loading={listLoading}>
          {excludedGroups.length ? excludedGroups.map(group => <Flex key={group.id} align="center" justify="space-between" gap={12} className="cache-exclusion-row">
            <Flex vertical gap={2} className="cache-exclusion-name">
              <Typography.Text strong>{group.name}</Typography.Text>
              <Typography.Text type="secondary" className="cache-exclusion-id">{group.id}</Typography.Text>
            </Flex>
            <Button size="small" loading={pendingExclusions.includes(group.id)} disabled={!status} onClick={() => setExcluded(group.id, false)}>取消排除</Button>
          </Flex>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无排除的群聊，请搜索会话名称添加" />}
        </Card>
        <Alert type="info" showIcon title="仅影响 WeTrace 本地缓存" description="微信原始记录不受影响。名单内群聊的 AI 分析、语音转写和图片理解不再新增缓存；已有语音/图片缓存及已生成报告保留。移出名单后点击“更新索引”即可重新收录。" />
      </Flex>,
    }]} />
    {(error || !!status?.errors.length) && <Alert type="warning" showIcon title="索引处理说明" description={[error, ...(status?.errors ?? [])].filter(Boolean).join('；')} />}
  </Card>
}
