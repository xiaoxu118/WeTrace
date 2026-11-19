export type PersonProfileTarget =
  | { kind: 'contact'; root: string; contactId: string }
  | { kind: 'group-member'; root: string; groupId: string; memberId: string }

export interface ProfileMessage {
  id: string
  createdAt: number
  target: boolean
  speaker: number
  text: string
}

export interface ProfileClip {
  anchor: ProfileMessage
  messages: ProfileMessage[]
}

export type ProfileCursor = [time: number, id: number, source: string]
export interface ProfilePageQuery {
  after?: ProfileCursor
  through?: ProfileCursor
}

export interface ProfileMessagePage {
  clips: (ProfileClip & { serverId?: string })[]
  next?: ProfileCursor
  snapshot?: { from: number; to: number; count: number; through?: ProfileCursor }
}

export const profileCategories = ['基础信息', '性格与行为', '兴趣爱好', '其他'] as const
export type ProfileCategory = typeof profileCategories[number]
export type ProfileSectionText = Record<ProfileCategory, string>

export function isProfileCategory(value: unknown): value is ProfileCategory {
  return profileCategories.some(category => category === value)
}

export interface ProfileObservation {
  category?: ProfileCategory
  detail: string
  references: number[]
}

export interface PersonProfile {
  from: number
  to: number
  evidence: ProfileClip[]
  observations: ProfileObservation[]
  analyzedMessages?: number
}

export function profileSectionText(profile: PersonProfile): ProfileSectionText {
  return Object.fromEntries(profileCategories.map(category => [
    category, profile.observations.filter(item => (item.category ?? '其他') === category)
      .map(item => item.detail).join('\n\n'),
  ])) as ProfileSectionText
}

export interface GeneratePersonProfileInput {
  requestId: string
  target: PersonProfileTarget
  name: string
  groupName?: string
}

export interface SavedPersonProfile {
  id: string
  revision: string
  target: PersonProfileTarget
  name: string
  groupName?: string
  updatedAt: number
  profile: PersonProfile
}

export interface EditPersonProfileInput {
  root: string
  id: string
  revision: string
  name: string
  sections: ProfileSectionText
}

export type PersonProfileResponse = { ok: true; record: SavedPersonProfile } | { ok: false; error: string; cancelled?: boolean }
export type ListPersonProfilesResponse = { ok: true; records: SavedPersonProfile[] } | { ok: false; error: string }
