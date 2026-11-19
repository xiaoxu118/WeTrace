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

export interface ProfileObservation {
  title: string
  detail: string
  references: number[]
}

export interface PersonProfile {
  from: number
  to: number
  evidence: ProfileClip[]
  observations: ProfileObservation[]
}

export interface GeneratePersonProfileInput {
  requestId: string
  target: PersonProfileTarget
}

export type PersonProfileResponse = { ok: true; profile: PersonProfile } | { ok: false; error: string }
