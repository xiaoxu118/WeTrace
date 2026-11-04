import { Alert, Button, Card, Empty, Input, Modal, Form, Radio, Pagination, Select, Space, Tag } from 'antd'
import { ChatText } from './ChatText'
import { useEffect, useRef, useState } from 'react'
import type { ConversationOption } from '../../../shared/types'
import type { MonitorQuery, MonitorState } from '../../../shared/group-monitor'
import { SafeText } from './SafeText'


const labels = { message: '聊天消息', left: '成员离群', joined: '成员加入', revoked: '消息撤回' }
export function GroupMonitor({ root, visible, onStateChange, conversations = [] }: { conversations?: ConversationOption[]; root: string; visible: boolean; onStateChange?: (root: string, state: MonitorState) => void }) {
  const [state, setState] = useState<MonitorState>({ rooms: [], events: [] })
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [groupSearch, setGroupSearch] = useState('')
  const [groups, setGroups] = useState<ConversationOption[]>([])
  const [selected, setSelected] = useState(''), [kind, setKind] = useState(''), [keyword, setKeyword] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm<{ rooms: string[]; eventKind: 'message' | 'left' | 'joined' }>()
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [selected, kind, keyword])
  const lock = useRef(false), alive = useRef(true)
  const requestQueue = useRef<Promise<unknown>>(Promise.resolve())
  function run(action: MonitorQuery['action'], rooms?: MonitorQuery['rooms'], quiet = false): Promise<boolean> {
    if (action === 'poll' && lock.current) return Promise.resolve(false)
    const task = requestQueue.current.then(async () => {
      if (!alive.current) return false
      lock.current = true
      if (!quiet) setBusy(true)
      try {
        const result = await window.wetrace.groupMonitor({ root, action, rooms })
        if (!alive.current) return false
        if (result.ok) { setState(result.data); onStateChange?.(root, result.data); setError(''); return true }
        setError(result.error)
      } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
      finally { lock.current = false; if (!quiet && alive.current) setBusy(false) }
      return false
    })
    requestQueue.current = task.catch(() => undefined)
    return task
  }
  useEffect(() => {
    alive.current = true
    void run('poll', undefined, true)
    const timer = window.setInterval(() => void run('poll', undefined, true), 5000)
    let debounce: number | undefined
    const unsubscribe = window.wetrace.onDatabaseChanged(changedRoot => {
      if (changedRoot !== root) return
      if (debounce !== undefined) window.clearTimeout(debounce)
      debounce = window.setTimeout(() => void run('poll', undefined, true), 1000)
    })
    return () => { alive.current = false; clearInterval(timer); clearTimeout(debounce); unsubscribe() }
  }, [root])
  useEffect(() => {
    if (!visible && !creating) return
    let active = true
    setCatalogLoading(true); setCatalogError('')
    void window.wetrace.listConversationOptions(root).then(result => {
      if (!active) return
      if (result.ok) setGroups(result.conversations.filter(item => item.id.endsWith('@chatroom') || item.type === 'group'))
      else setCatalogError(result.error)
    }).catch(error => { if(active)setCatalogError(error instanceof Error ? error.message : '读取群聊失败') })
      .finally(()=>{if(active)setCatalogLoading(false)})
    return ()=>{active=false}
  }, [root, visible, creating])
  const room = state.rooms.find(item => item.id === selected)
  const options = [...new Map([...conversations.filter(item=>item.type==='group' || item.id.endsWith('@chatroom')), ...state.rooms.filter(item=>item.id.endsWith('@chatroom')).map(item=>({id:item.id,name:item.name,type:'group' as const})), ...groups].map(item=>[item.id,item])).values()]
  const revokedIds = new Set(state.rooms.flatMap(item => item.messages.filter(message => message.revoked).map(message => `${item.id}:message:${message.id}`)))
  const events = state.events.filter(event => event.kind !== 'revoked' && !revokedIds.has(event.id) && (!selected || event.room === selected) && (!kind || event.kind === kind) && (!keyword || `${event.sender} ${event.text} ${event.original || ''}`.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()))).slice().reverse()
  return <section className="group-monitor" style={{ display: visible ? undefined : 'none' }} aria-label="群聊监控">
    <header className="monitor-header"><div><h2>群聊监控</h2></div><Space><Button loading={busy} onClick={() => void run('poll')}>刷新</Button></Space></header>
    <Modal title="新建监控事件" open={creating} onCancel={()=>{if(!submitting)setCreating(false)}} okText="创建并开启" cancelText="取消" okButtonProps={{ disabled: submitting }} cancelButtonProps={{ disabled: submitting }} onOk={()=>form.submit()} destroyOnHidden>
      {catalogError && <Alert type="error" title={catalogError} />}
      <Form form={form} layout="vertical" initialValues={{rooms:[],eventKind:'message'}} onFinish={async values=>{
        if (submitting) return
        setSubmitting(true)
        try {
        const saved = await run('configure', values.rooms.map(id=>({id,name:options.find(item=>item.id===id)?.name || id,enabled:true,eventKinds:[values.eventKind]})))
        if (saved && alive.current) { setCreating(false); setSelected(values.rooms.length===1 ? values.rooms[0] : ''); void run('poll', undefined, true) }
        } finally { if(alive.current)setSubmitting(false) }
      }}>
        <Form.Item name="rooms" label="监控群聊" rules={[{required:true,message:'请选择至少一个群聊'}]}><Select mode="multiple" aria-label="新建事件监控群聊" loading={catalogLoading} getPopupContainer={trigger=>trigger.parentElement!} showSearch={{searchValue:groupSearch,onSearch:setGroupSearch,filterOption:false}} placeholder="搜索或选择群聊" notFoundContent={catalogLoading ? '正在加载…' : '没有匹配的群聊'} options={options.filter(item=>`${item.name} ${item.id}`.toLocaleLowerCase().includes(groupSearch.trim().toLocaleLowerCase())).map(item=>({value:item.id,label:item.name}))} /></Form.Item>
        <Form.Item name="eventKind" label="事件类型" rules={[{required:true,message:'请选择事件类型'}]}><Radio.Group options={[{value:'message',label:'聊天消息'},{value:'left',label:'成员离群'},{value:'joined',label:'成员加入'}]} /></Form.Item>
      </Form>
    </Modal>
    <Space wrap className="monitor-filters" align="end">
      <div><div className="monitor-filter-label">监控群聊</div><Select aria-label="监控群聊" showSearch={{ filterOption: (input, option) => `${option?.label ?? ''} ${option?.value ?? ''}`.toLocaleLowerCase().includes(input.trim().toLocaleLowerCase()) }} value={selected} onChange={setSelected} style={{ width: 280 }} options={[{value:'',label:'全部监控记录'},...options.map(group=>({value:group.id,label:`${state.rooms.find(item=>item.id===group.id)?.enabled ? '● ' : ''}${group.name}`}))]} /></div>
      {selected && <Button type={room?.enabled ? 'default' : 'primary'} disabled={busy} onClick={async () => {
        await run('configure', [{ id: selected, name: options.find(item => item.id === selected)?.name || selected, enabled: !room?.enabled }])
        if (alive.current) void run('poll')
      }}>{room?.enabled ? '暂停此群监控' : '开启此群监控'}</Button>}
      <div><div className="monitor-filter-label">事件类型</div><Select aria-label="事件类型" value={kind} onChange={setKind} style={{width:140}} options={[{value:'',label:'全部事件'},...Object.entries(labels).filter(([id])=>id!=='revoked').map(([value,label])=>({value,label}))]} /></div>
      <div><div className="monitor-filter-label">搜索内容</div><Input.Search allowClear placeholder="成员或聊天关键词" value={keyword} onChange={event=>setKeyword(event.target.value)} /></div>
      <Button onClick={()=>{setSelected('');setKind('');setKeyword('')}}>重置筛选</Button>
      <Button type="primary" onClick={() => { form.resetFields(); setGroupSearch(''); setCreating(true) }}>新建事件</Button>
    </Space>
    <div className="monitor-status"><Space><Tag color="green">正在监控 {state.rooms.filter(item=>item.enabled).reduce((total, item)=>total + (item.eventKinds?.length ?? 3), 0)} 个事件</Tag><span>{events.length} 条匹配记录</span></Space></div>
    {error && <Alert type="error" showIcon title={error} action={<Button size="small" onClick={()=>void run('poll')}>重试</Button>} />}
    {state.rooms.filter(item=>item.enabled && (!selected || item.id===selected)).map(item=><div key={item.id} className="monitor-room-status"><Tag color={item.error ? 'error' : 'success'}><SafeText>{item.name}</SafeText></Tag>{item.error || (item.checkedAt ? `最近检查 ${new Date(item.checkedAt).toLocaleString('zh-CN')}` : '等待首次检查')}</div>)}
    <div className="monitor-events">{!events.length ? <Empty description={state.rooms.some(item=>item.enabled) ? '暂无匹配事件' : '选择群聊并开启监控，首次读取会建立基线'} /> : events.slice((Math.min(page, Math.max(1,Math.ceil(events.length/20)))-1)*20,Math.min(page,Math.max(1,Math.ceil(events.length/20)))*20).map(event=><Card key={event.id} size="small" title={<Space wrap><Tag color={event.kind==='message' ? 'blue' : event.kind==='left' ? 'orange' : 'green'}>{labels[event.kind]}</Tag><SafeText>{state.rooms.find(item=>item.id===event.room)?.name || event.room}</SafeText></Space>} extra={<span className="monitor-event-time">{new Date(event.at).toLocaleString('zh-CN')}</span>}><div className="monitor-event-sender"><SafeText>{event.sender}</SafeText></div><p className="monitor-event-content"><ChatText>{event.text}</ChatText></p></Card>)}</div>
    <Pagination current={Math.min(page,Math.max(1,Math.ceil(events.length/20)))} pageSize={20} total={events.length} onChange={setPage} showSizeChanger={false} hideOnSinglePage showTotal={total=>`共 ${total} 条记录`} />
  </section>
}
