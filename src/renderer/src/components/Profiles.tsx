import { ProfilePersonSelect, profilePersonChoices } from './ProfilePersonSelect'
import { Alert, Avatar, Button, Card, Drawer, Empty, Input, Segmented, Space, Table, Typography } from 'antd'
import { ActionButton } from './ui/ActionButton'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EditPersonProfileInput, GeneratePersonProfileInput, PersonProfileTarget, SavedPersonProfile } from '../../../shared/person-profile'
import { profileCategories, profileSectionText } from '../../../shared/person-profile'
import type { ConversationOption, ConversationOptionsResponse, GroupMembersResponse } from '../../../shared/types'
import { firstGrapheme, SafeText } from './SafeText'

type ProfileCategory = '联系人' | '群成员'

type ProfileJob = { id: string; name: string; detail: string; cancelling?: boolean }
type ProfileJobResult = { status: 'saved' | 'cancelled' | 'failed'; name: string; detail: string }
const jobResultTitles = { saved: '画像已保存', cancelled: '画像更新已取消', failed: '画像更新失败' }

function sourceName(item: SavedPersonProfile) {
  return item.target.kind === 'contact' ? '私聊' : item.groupName ?? '群聊'
}

function observationCategories(item: SavedPersonProfile) {
  return profileCategories.filter(category => category === '基础信息'
    || item.profile.observations.some(observation => (observation.category ?? '其他') === category))
}

function profileKey(target: PersonProfileTarget) {
  return JSON.stringify(target.kind === 'contact' ? [target.contactId] : [target.groupId, target.memberId])
}

export function Profiles({ root, recentConversations, visible }: {
  root?: string
  recentConversations?: ConversationOption[]
  visible: boolean
}) {
  const [catalogAttempt, retryCatalog] = useState(0)
  const [membersAttempt, retryMembers] = useState(0)
  const [profiles, setProfiles] = useState(new Map<string, SavedPersonProfile>())
  const [selectedProfile, setSelectedProfile] = useState<string>()
  const [profileOpen, setProfileOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [archiveAttempt, retryArchive] = useState(0)
  const [archiveError, setArchiveError] = useState('')
  const [edit, setEdit] = useState<EditPersonProfileInput>()
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)
  const [job, setJob] = useState<ProfileJob>()
  const jobRef = useRef<string | undefined>(undefined)
  const [jobResult, setJobResult] = useState<ProfileJobResult>()
  const [visited, setVisited] = useState(visible)

  useEffect(() => { if (visible) setVisited(true) }, [visible])
  useEffect(() => {
    if (!root || !visited) return
    let active = true
    void window.wetrace.listPersonProfiles(root).then(result => {
      if (!active) return
      if (!result.ok) throw new Error(result.error)
      setProfiles(current => {
        const merged = new Map(current)
        for (const record of result.records) {
          const key = profileKey(record.target)
          if ((merged.get(key)?.updatedAt ?? 0) <= record.updatedAt) merged.set(key, record)
        }
        return merged
      })
    }).catch(error => {
      if (active) setArchiveError(error instanceof Error ? error.message : '读取画像列表失败')
    })
    return () => { active = false }
  }, [root, visited, archiveAttempt])
  useEffect(() => {
    const unsubscribe = window.wetrace.onAiProgress?.(({ requestId, detail }) => {
      setJob(current => current?.id === requestId ? { ...current, detail } : current)
    })
    return () => {
      unsubscribe?.()
      if (jobRef.current) void window.wetrace.cancelAi(jobRef.current).catch(() => undefined)
      jobRef.current = undefined
    }
  }, [])
  const [category, setCategory] = useState<ProfileCategory>('联系人')
  const [conversations, setConversations] = useState<ConversationOptionsResponse>()
  const [contactId, setContactId] = useState<string>()
  const [groupId, setGroupId] = useState<string>()
  const [memberId, setMemberId] = useState<string>()
  const [groupMembers, setGroupMembers] = useState<GroupMembersResponse>()

  useEffect(() => {
    if (!root || !visited) return
    let current = true
    void window.wetrace.listConversationOptions(root, true).then(result => {
      if (current) setConversations(result)
    }).catch(() => {
      if (current) setConversations({ ok: false, error: '读取会话失败' })
    })
    return () => { current = false }
  }, [root, catalogAttempt, visited])

  useEffect(() => {
    if (!root || !groupId) return
    let current = true
    void window.wetrace.listGroupMembers({ root, conversationId: groupId }).then(result => {
      if (current) setGroupMembers(result)
    }).catch(() => {
      if (current) setGroupMembers({ ok: false, error: '读取群成员失败' })
    })
    return () => { current = false }
  }, [root, groupId, membersAttempt])

  const jobStatus = job || jobResult ? createPortal(
    <div className="profile-job-status" data-status={job ? 'running' : jobResult?.status} aria-label="画像更新状态">
      <div className="profile-job-status-text" role={jobResult?.status === 'failed' ? 'alert' : 'status'}>
        <Typography.Text strong>{job ? '正在更新画像' : jobResult && jobResultTitles[jobResult.status]}</Typography.Text>
        <Typography.Text type="secondary"><SafeText>{job?.name ?? jobResult?.name ?? ''}</SafeText></Typography.Text>
        <Typography.Text>{job ? (job.cancelling ? '正在取消…' : job.detail) : jobResult?.detail}</Typography.Text>
      </div>
      {job
        ? <ActionButton className="sm" disabled={job.cancelling} onClick={() => void cancelProfileUpdate(job.id)}>取消</ActionButton>
        : <ActionButton className="sm" onClick={() => setJobResult(undefined)}>关闭</ActionButton>}
    </div>,
    document.body,
  ) : null

  if (!visible) return jobStatus

  const recentById = new Map(recentConversations?.map(item => [item.id, item]))
  const options = conversations?.ok
    ? conversations.conversations.map(item => ({ ...item, avatar: item.avatar ?? recentById.get(item.id)?.avatar }))
    : recentConversations ?? []
  const contacts = options.filter(item => item.type === 'friend')
  const groups = options.filter(item => item.type === 'group')
  const members = groupMembers?.ok ? groupMembers.members : []
  const group = groups.find(item => item.id === groupId)
  const person = category === '联系人'
    ? contacts.find(item => item.id === contactId)
    : members.find(item => item.id === memberId)

  const personName = person && profilePersonChoices(category, category === '联系人' ? contacts : members)
    .find(choice => choice.value === person.id)?.label
  const updateTarget: PersonProfileTarget | undefined = root && person
    ? category === '联系人'
      ? { kind: 'contact', root, contactId: person.id }
      : group && { kind: 'group-member', root, groupId: group.id, memberId: person.id }
    : undefined

  const targetKey = selectedProfile ?? (updateTarget ? profileKey(updateTarget) : '')
  const record = profiles.get(targetKey)
  const profile = record?.profile
  const sections = profile && profileSectionText(profile)
  const searchTerms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const matchingProfiles = [...profiles.values()].filter(item => {
    const categories = observationCategories(item)
    const content = [item.name, sourceName(item), ...categories,
      ...item.profile.observations.map(({ detail }) => detail)].join('\n').toLocaleLowerCase()
    return searchTerms.every(term => content.includes(term))
  }).sort((a, b) => b.updatedAt - a.updatedAt)
  const generationTarget = selectedProfile ? record?.target : updateTarget
  const generationName = record?.name ?? personName
  const groupName = generationTarget?.kind === 'group-member'
    ? record?.groupName ?? (group && (group.name === group.id ? '未命名群聊' : group.name))
    : undefined

  async function requestProfileUpdate(input: Omit<GeneratePersonProfileInput, 'requestId'>) {
    if (jobRef.current) return
    const id = crypto.randomUUID()
    const key = profileKey(input.target)
    jobRef.current = id
    setJobResult(undefined)
    setJob({ id, name: input.name, detail: '正在读取聊天记录…' })
    try {
      const result = await window.wetrace.generatePersonProfile({ ...input, requestId: id })
      if (jobRef.current !== id) return
      if (!result.ok) {
        setJobResult({ status: result.cancelled ? 'cancelled' : 'failed', name: input.name,
          detail: result.cancelled ? '本次更新未保存' : result.error })
        return
      }
      setProfiles(current => new Map(current).set(key, result.record))
      setJobResult({ status: 'saved', name: result.record.name, detail: '可在画像列表查看' })
    } catch (error) {
      if (jobRef.current === id) setJobResult({ status: 'failed', name: input.name,
        detail: error instanceof Error ? error.message : '请重试' })
    } finally {
      if (jobRef.current === id) {
        jobRef.current = undefined
        setJob(undefined)
      }
    }
  }

  async function cancelProfileUpdate(id: string) {
    setJob(current => current?.id === id ? { ...current, cancelling: true } : current)
    try { await window.wetrace.cancelAi(id) }
    catch {
      setJob(current => current?.id === id ? { ...current, cancelling: false, detail: '取消失败，可重试' } : current)
    }
  }

  function changeSelection() {
    setSelectedProfile(undefined)
  }

  function viewProfile(item: SavedPersonProfile) {
    setSelectedProfile(profileKey(item.target))
    setCategory(item.target.kind === 'contact' ? '联系人' : '群成员')
    setContactId(undefined)
    setGroupId(undefined)
    setMemberId(undefined)
    setGroupMembers(undefined)
    setProfileOpen(true)
  }

  function editProfile(item: SavedPersonProfile) {
    setEditError('')
    setEdit({ root: item.target.root, id: item.id, revision: item.revision, name: item.name,
      sections: profileSectionText(item.profile) })
  }

  async function saveEdit() {
    if (!edit || saving) return
    setSaving(true)
    setEditError('')
    try {
      const result = await window.wetrace.editPersonProfile(edit)
      if (!result.ok) throw new Error(result.error)
      setProfiles(current => new Map(current).set(profileKey(result.record.target), result.record))
      setEdit(undefined)
    } catch (error) {
      setEditError(error instanceof Error ? error.message : '保存画像失败')
    } finally { setSaving(false) }
  }

  return (
    <section className="view active profiles-view" aria-label="画像">
      <Space align="center" size={12}>
        <Typography.Title level={3} style={{ margin: 0 }}>画像</Typography.Title>
        <ActionButton className="btn primary" disabled={!generationTarget || !generationName || Boolean(job)} onClick={() => {
          if (generationTarget && generationName) void requestProfileUpdate({ target: generationTarget, name: generationName, groupName })
        }}>
          {job ? '更新中…' : '更新画像'}
        </ActionButton>
      </Space>
      <Segmented<ProfileCategory> options={['联系人', '群成员']} value={category} onChange={value => { setCategory(value); changeSelection() }} />
      {!root ? <Empty description="请先连接微信账号" />
        : category === '联系人' ? (
          <ProfilePersonSelect
            key="contacts" label="联系人" options={contacts}
            loading={!conversations && !contacts.length} empty={!conversations ? "正在读取联系人…" : "没有匹配的联系人"}
            value={contactId} onChange={id => { setContactId(id); changeSelection() }}
          />
        ) : (
          <>
            <ProfilePersonSelect
              key="groups" label="群聊" options={groups} value={groupId}
              loading={!conversations && !groups.length} empty={!conversations ? "正在读取群聊…" : "没有匹配的群聊"}
              onChange={id => {
                changeSelection()
                setGroupId(id)
                setMemberId(undefined)
                setGroupMembers(undefined)
              }}
            />
            {group && (
              <ProfilePersonSelect
                key={group.id} label="群成员" options={members} empty={!groupMembers ? "正在读取群成员…" : "没有匹配的群成员"}
                value={memberId} onChange={id => { setMemberId(id); changeSelection() }}
                loading={!groupMembers} disabled={groupMembers?.ok === false}
              />
            )}
            {groupMembers && !groupMembers.ok && (
              <Alert type="error" message={groupMembers.error} action={<ActionButton onClick={() => {
                setGroupMembers(undefined)
                retryMembers(attempt => attempt + 1)
              }}>重试</ActionButton>} />
            )}
          </>
        )}
      {conversations && !conversations.ok && (
        <Alert type="error" message={conversations.error} action={<ActionButton onClick={() => {
          setConversations(undefined)
          retryCatalog(attempt => attempt + 1)
        }}>重试</ActionButton>} />
      )}
      {!record && person && personName && (
        <Space align="center" size={12}>
          <Avatar size={44} src={person.avatar}>{firstGrapheme(personName)}</Avatar>
          <Space direction="vertical" size={0}>
            <Typography.Text strong><SafeText>{personName}</SafeText></Typography.Text>
            {category === '群成员' && group && <Typography.Text type="secondary"><SafeText>{group.name === group.id ? '未命名群聊' : group.name}</SafeText></Typography.Text>}
          </Space>
        </Space>
      )}
      {jobStatus}
      {root && <section className="profile-list" aria-labelledby="profile-list-heading">
        <div className="profile-list-toolbar">
          <Typography.Title id="profile-list-heading" level={4}>画像列表</Typography.Title>
          <Input aria-label="搜索画像" placeholder="搜索姓名、群名或画像内容" allowClear value={search}
            onChange={event => setSearch(event.target.value)} />
        </div>
        {archiveError && <Alert type="error" message={archiveError} action={<ActionButton onClick={() => {
          setArchiveError('')
          retryArchive(attempt => attempt + 1)
        }}>重试</ActionButton>} />}
        <Table<SavedPersonProfile>
          dataSource={matchingProfiles}
          rowKey="id"
          pagination={false}
          scroll={{ x: 640 }}
          tableLayout="fixed"
          locale={{ emptyText: searchTerms.length ? '没有匹配的画像' : '暂无已保存的画像' }}
          rowClassName={item => record?.id === item.id ? 'profile-row-active' : ''}
          columns={[
            { title: '人物', key: 'name', ellipsis: true, render: (_, item) => (
              <div className="profile-table-person">
                <Avatar size={34} src={recentById.get(item.target.kind === 'contact' ? item.target.contactId : item.target.memberId)?.avatar}>
                  {firstGrapheme(item.name)}
                </Avatar>
                <span className="profile-table-name" title={item.name}><SafeText>{item.name}</SafeText></span>
              </div>
            ) },
            { title: '来源', key: 'source', width: '19%', ellipsis: true, render: (_, item) => (
              <span className="profile-table-source" title={sourceName(item)}><SafeText>{sourceName(item)}</SafeText></span>
            ) },
            { title: '基础信息', key: 'basicInfo', width: '36%', ellipsis: { showTitle: false }, render: (_, item) => {
              const summary = item.profile.observations.filter(entry => entry.category === '基础信息')
                .map(({ detail }) => detail).join(' ')
              return <span className="profile-table-source" title={summary || undefined}><SafeText>{summary || '—'}</SafeText></span>
            } },
            { title: '更新时间', key: 'updated', width: 144, render: (_, item) => (
              <time dateTime={new Date(item.updatedAt).toISOString()}>{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</time>
            ) },
            { title: '操作', key: 'actions', width: 128, align: 'right', render: (_, item) => (
              <Space size={4}>
                <Button type="link" size="small" aria-label={`查看画像 ${item.name}`} onClick={() => viewProfile(item)}>查看</Button>
                <Button type="link" size="small" aria-label={`编辑画像 ${item.name}`} disabled={Boolean(job)} onClick={() => {
                  viewProfile(item)
                  editProfile(item)
                }}>编辑</Button>
              </Space>
            ) },
          ]}
        />
      </section>}
      <Drawer title={edit ? '编辑画像' : '查看画像'} size="min(100vw, 760px)" open={profileOpen && Boolean(record)}
        destroyOnHidden className="profile-editor"
        mask={{ closable: !edit }} keyboard={!saving} onClose={() => {
          if (saving) return
          setEdit(undefined)
          setProfileOpen(false)
        }}
        footer={<>
          {edit && editError && <Alert type="error" message={editError} />}
          <div className="profile-editor-actions">
            {edit ? <>
              <Button disabled={saving} onClick={() => setEdit(undefined)}>取消</Button>
              <Button type="primary" loading={saving} onClick={() => void saveEdit()}>保存</Button>
            </> : <>
              <Button onClick={() => setProfileOpen(false)}>关闭</Button>
              <Button type="primary" disabled={!record || Boolean(job)}
                onClick={() => { if (record) editProfile(record) }}>编辑</Button>
            </>}
          </div>
        </>}>
        {!edit && record && profile && sections && (
          <div className="profile-observations">
            {observationCategories(record).map(category => (
              <section className="profile-category" key={category}>
                <Typography.Title level={5}>{category}</Typography.Title>
                <Card size="small">
                  {category === '基础信息' && <Space direction="vertical">
                    <Typography.Text strong><SafeText>{record.name}</SafeText></Typography.Text>
                    <Typography.Text type="secondary"><SafeText>{sourceName(record)}</SafeText></Typography.Text>
                    <Typography.Text type="secondary">样本日期 {new Date(profile.from).toLocaleDateString('zh-CN')} 至 {new Date(profile.to).toLocaleDateString('zh-CN')}</Typography.Text>
                    {profile.analyzedMessages !== undefined && <Typography.Text type="secondary">已分析 {profile.analyzedMessages.toLocaleString('zh-CN')} 条文字消息</Typography.Text>}
                  </Space>}
                  {sections[category] && <Typography.Paragraph className="profile-section-text"><SafeText>{sections[category]}</SafeText></Typography.Paragraph>}
                </Card>
              </section>
            ))}
          </div>
        )}
        {edit && <div className="profile-editor-fields">
          <label className="profile-editor-field">画像名称
            <Input size="large" maxLength={200} disabled={saving} value={edit.name}
              onChange={event => setEdit({ ...edit, name: event.target.value })} />
          </label>
          {profileCategories.map(category => (
            <fieldset key={category} className="profile-editor-observation">
              <legend>{category}</legend>
              <Input.TextArea aria-label={category} autoSize={{ minRows: 5 }} disabled={saving} value={edit.sections[category]}
                onChange={event => {
                  const value = event.target.value
                  setEdit(current => current && { ...current, sections: { ...current.sections, [category]: value } })
                }} />
            </fieldset>
          ))}
        </div>}
      </Drawer>
    </section>
  )
}
