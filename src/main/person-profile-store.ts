import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { EditPersonProfileInput, GeneratePersonProfileInput, PersonProfile, ProfileCategory, ProfileObservation, SavedPersonProfile } from '../shared/person-profile'
import { isProfileCategory, profileCategories } from '../shared/person-profile.ts'

type StoredProfile = Omit<SavedPersonProfile, 'profile'> & {
  profile: Omit<PersonProfile, 'observations'> & {
    sections: Record<ProfileCategory, Omit<ProfileObservation, 'category'>[]>
  }
}

function displayName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) throw new Error('请输入有效的画像名称')
  return value.trim()
}

function readProfile(content: string): SavedPersonProfile {
  const record = JSON.parse(content) as SavedPersonProfile | StoredProfile
  if ('sections' in record.profile) {
    const { sections, ...profile } = record.profile
    const observations = profileCategories.flatMap(category =>
      (sections[category] ?? []).map(({ detail, references }) => ({ detail, references, category })))
    return { ...record, profile: { ...profile, observations } }
  }
  const observations = record.profile.observations.map(({ category, detail, references }) => ({
    category: isProfileCategory(category) ? category : '其他' as const,
    detail, references,
  }))
  return { ...record, profile: { ...record.profile, observations } }
}

function serializeProfile(record: SavedPersonProfile): string {
  const { observations, ...profile } = record.profile
  const sections = Object.fromEntries(profileCategories.map(category => [
    category, observations
      .filter(item => (isProfileCategory(item.category) ? item.category : '其他') === category)
      .map(({ detail, references }) => ({ detail, references })),
  ]))
  return JSON.stringify({ ...record, profile: { ...profile, sections } })
}

export class PersonProfileStore {
  private readonly file: string

  constructor(file: string) { this.file = file }

  private withDatabase<T>(run: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(this.file)
    try {
      db.exec(`
        PRAGMA busy_timeout = 3000;
        CREATE TABLE IF NOT EXISTS person_profiles (
          account TEXT NOT NULL,
          id TEXT NOT NULL,
          revision TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          content TEXT NOT NULL,
          PRIMARY KEY (account, id)
        );
      `)
      return run(db)
    } finally { db.close() }
  }

  list(root: string): SavedPersonProfile[] {
    if (typeof root !== 'string' || !root.trim()) throw new Error('请先连接微信账号')
    return this.withDatabase(db => db.prepare(
      'SELECT content FROM person_profiles WHERE account = ? ORDER BY updated_at DESC, id',
    ).all(root).map(row => readProfile(String(row.content))))
  }

  saveGenerated(input: GeneratePersonProfileInput, profile: PersonProfile): SavedPersonProfile {
    const { target } = input
    const key = target.kind === 'contact' ? [target.kind, target.contactId] : [target.kind, target.groupId, target.memberId]
    const record: SavedPersonProfile = {
      id: createHash('sha256').update(JSON.stringify(key)).digest('hex'),
      revision: randomUUID(),
      target,
      name: displayName(input.name),
      ...(target.kind === 'group-member' && input.groupName ? { groupName: displayName(input.groupName) } : {}),
      updatedAt: Date.now(),
      profile,
    }
    const content = serializeProfile(record)
    return this.withDatabase(db => {
      db.prepare(`
        INSERT INTO person_profiles (account, id, revision, updated_at, content) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (account, id) DO UPDATE SET
          revision = excluded.revision, updated_at = excluded.updated_at, content = excluded.content
      `).run(target.root, record.id, record.revision, record.updatedAt, content)
      return readProfile(content)
    })
  }

  edit(input: EditPersonProfileInput): SavedPersonProfile {
    if (!input || typeof input.root !== 'string' || !input.root || typeof input.id !== 'string'
      || typeof input.revision !== 'string' || !input.sections
      || !profileCategories.every(category => typeof input.sections[category] === 'string')) throw new Error('画像修改无效')
    if (typeof input.name !== 'string') throw new Error('画像修改无效')
    return this.withDatabase(db => {
      const row = db.prepare('SELECT content FROM person_profiles WHERE account = ? AND id = ? AND revision = ?')
        .get(input.root, input.id, input.revision)
      if (!row) throw new Error('画像已更新，请重新打开画像后再编辑')
      const previous = readProfile(String(row.content))
      const name = displayName(input.name.trim() || previous.name)
      const observations = profileCategories.flatMap(category => {
        const detail = input.sections[category].trim()
        if (!detail) return []
        const references = [...new Set(previous.profile.observations
          .filter(item => item.category === category).flatMap(item => item.references))]
        return [{ category, detail, references }]
      })
      const record: SavedPersonProfile = {
        ...previous, name, revision: randomUUID(), updatedAt: Date.now(),
        profile: { ...previous.profile, observations },
      }
      const content = serializeProfile(record)
      const result = db.prepare(`
        UPDATE person_profiles SET revision = ?, updated_at = ?, content = ?
        WHERE account = ? AND id = ? AND revision = ?
      `).run(record.revision, record.updatedAt, content, input.root, input.id, input.revision)
      if (!result.changes) throw new Error('画像已更新，请重新打开画像后再编辑')
      return readProfile(content)
    })
  }
}
