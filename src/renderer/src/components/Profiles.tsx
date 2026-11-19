import { ProfilePersonSelect } from './ProfilePersonSelect'
import { Alert, Avatar, Card, Empty, Modal, Segmented, Space, Typography } from 'antd'
import { ActionButton } from './ui/ActionButton'
import { useEffect, useRef, useState } from 'react'
import type { PersonProfile, PersonProfileTarget, ProfileClip, ProfileMessage } from '../../../shared/person-profile'
import type { ConversationOption, ConversationOptionsResponse, GroupMembersResponse } from '../../../shared/types'
import { firstGrapheme, SafeText } from './SafeText'

type ProfileCategory = '联系人' | '群成员'

type ProfileJob = { id: string; detail: string }

export function Profiles({ root, recentConversations, visible, onOpenMessage }: {
  root?: string
  recentConversations?: ConversationOption[]
  visible: boolean
  onOpenMessage: (room: string, message: ProfileMessage) => Promise<void>
}) {
  const [catalogAttempt, retryCatalog] = useState(0)
  const [membersAttempt, retryMembers] = useState(0)
  const [profiles, setProfiles] = useState(new Map<string, PersonProfile>())
  const [job, setJob] = useState<ProfileJob>()
  const jobRef = useRef<string | undefined>(undefined)
  const [failure, setFailure] = useState<{ key: string; message: string }>()
  const [citation, setCitation] = useState<ProfileClip>()
  const [opening, setOpening] = useState(false)
  const [citationError, setCitationError] = useState('')
  const [visited, setVisited] = useState(visible)

  useEffect(() => { if (visible) setVisited(true) }, [visible])
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

  if (!visible) return null

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

  const personName = person && (person.name === person.id ? (category === '联系人' ? '未命名联系人' : '未命名群成员') : person.name)
  const updateTarget: PersonProfileTarget | undefined = root && person
    ? category === '联系人'
      ? { kind: 'contact', root, contactId: person.id }
      : group && { kind: 'group-member', root, groupId: group.id, memberId: person.id }
    : undefined

  const targetKey = updateTarget ? JSON.stringify(updateTarget) : ''
  const profile = profiles.get(targetKey)

  async function requestProfileUpdate(target: PersonProfileTarget) {
    if (jobRef.current) return
    const id = crypto.randomUUID()
    const key = JSON.stringify(target)
    jobRef.current = id
    setFailure(undefined)
    setJob({ id, detail: '正在选取聊天片段…' })
    try {
      const result = await window.wetrace.generatePersonProfile({ requestId: id, target })
      if (jobRef.current !== id) return
      if (!result.ok) throw new Error(result.error)
      setProfiles(current => new Map(current).set(key, result.profile))
    } catch (error) {
      if (jobRef.current === id) setFailure({ key, message: error instanceof Error ? error.message : '更新画像失败' })
    } finally {
      if (jobRef.current === id) {
        jobRef.current = undefined
        setJob(undefined)
      }
    }
  }

  async function openOriginal() {
    if (!citation || !updateTarget || opening) return
    setOpening(true)
    setCitationError('')
    try {
      await onOpenMessage(updateTarget.kind === 'contact' ? updateTarget.contactId : updateTarget.groupId, citation.anchor)
      setCitation(undefined)
    } catch (error) {
      setCitationError(error instanceof Error ? error.message : '打开聊天记录失败')
    } finally { setOpening(false) }
  }

  return (
    <section className="view active profiles-view" aria-label="画像">
      <Space align="center" size={12}>
        <Typography.Title level={3} style={{ margin: 0 }}>画像</Typography.Title>
        <ActionButton className="btn primary" disabled={!updateTarget || Boolean(job)} onClick={() => {
          if (updateTarget) void requestProfileUpdate(updateTarget)
        }}>
          更新画像
        </ActionButton>
      </Space>
      <Segmented<ProfileCategory> options={['联系人', '群成员']} value={category} onChange={value => { setCategory(value); setCitation(undefined) }} />
      {!root ? <Empty description="请先连接微信账号" />
        : category === '联系人' ? (
          <ProfilePersonSelect
            key="contacts" label="联系人" options={contacts}
            loading={!conversations && !contacts.length} empty={!conversations ? "正在读取联系人…" : "没有匹配的联系人"}
            value={contactId} onChange={id => { setContactId(id); setCitation(undefined) }}
          />
        ) : (
          <>
            <ProfilePersonSelect
              key="groups" label="群聊" options={groups} value={groupId}
              loading={!conversations && !groups.length} empty={!conversations ? "正在读取群聊…" : "没有匹配的群聊"}
              onChange={id => {
                setCitation(undefined)
                setGroupId(id)
                setMemberId(undefined)
                setGroupMembers(undefined)
              }}
            />
            {group && (
              <ProfilePersonSelect
                key={group.id} label="群成员" options={members} empty={!groupMembers ? "正在读取群成员…" : "没有匹配的群成员"}
                value={memberId} onChange={id => { setMemberId(id); setCitation(undefined) }}
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
      {person && personName && (
        <Space align="center" size={12}>
          <Avatar size={44} src={person.avatar}>{firstGrapheme(personName)}</Avatar>
          <Space direction="vertical" size={0}>
            <Typography.Text strong><SafeText>{personName}</SafeText></Typography.Text>
            {category === '群成员' && group && <Typography.Text type="secondary"><SafeText>{group.name === group.id ? '未命名群聊' : group.name}</SafeText></Typography.Text>}
          </Space>
        </Space>
      )}
      {job && <Space>
        <Typography.Text role="status">{job.detail}</Typography.Text>
        <ActionButton onClick={() => void window.wetrace.cancelAi(job.id).catch(() => undefined)}>取消</ActionButton>
      </Space>}
      {failure?.key === targetKey && <Alert type="error" message={failure.message} />}
      {profile && (
        <div className="profile-observations">
          <Typography.Text type="secondary">{new Date(profile.from).toLocaleDateString('zh-CN')} 至 {new Date(profile.to).toLocaleDateString('zh-CN')}</Typography.Text>
          {!profile.observations.length && <Empty description="样本不足以归纳出有依据的观察" />}
          {profile.observations.map((observation, index) => (
            <Card key={index} size="small" title={<SafeText>{observation.title}</SafeText>}>
              <Typography.Paragraph><SafeText>{observation.detail}</SafeText></Typography.Paragraph>
              <Space wrap>
                {observation.references.map((ref, index) => (
                  <ActionButton key={ref} className="btn sm" onClick={() => {
                    setCitationError('')
                    setCitation(profile.evidence[ref - 1])
                  }}>聊天证据 {index + 1}</ActionButton>
                ))}
              </Space>
            </Card>
          ))}
        </div>
      )}
      <Modal title="聊天证据" open={Boolean(citation)} onCancel={() => setCitation(undefined)} footer={
        <ActionButton className="btn primary" disabled={opening} onClick={() => void openOriginal()}>打开聊天记录</ActionButton>
      }>
        {citation?.messages.map((message, index) => (
          <div className="profile-evidence-message" key={index}>
            <Typography.Text type="secondary">{message.target ? '画像对象' : `参与者 ${message.speaker}`} · {new Date(message.createdAt).toLocaleString('zh-CN')}</Typography.Text>
            <Typography.Paragraph strong={message === citation.anchor || message.id === citation.anchor.id && message.createdAt === citation.anchor.createdAt}><SafeText>{message.text}</SafeText></Typography.Paragraph>
          </div>
        ))}
        {citationError && <Alert type="error" message={citationError} />}
      </Modal>
    </section>
  )
}
