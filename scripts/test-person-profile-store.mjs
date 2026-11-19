import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { PersonProfileStore } from '../src/main/person-profile-store.ts'

const directory = mkdtempSync(join(tmpdir(), 'wetrace-person-profiles-'))
try {
  const file = join(directory, 'profiles.sqlite')
  const store = new PersonProfileStore(file)
  const target = { kind: 'contact', root: 'fixture-account', contactId: 'fixture-contact' }
  const input = { requestId: 'fixture-request', target, name: '虚构联系人' }
  const message = { id: 'fixture-message', createdAt: 1, target: true, speaker: 0, text: '虚构聊天证据' }
  const profile = {
    from: 1, to: 2,
    evidence: [{ anchor: message, messages: [message] }],
    observations: [{ detail: '虚构观察', references: [1] }],
  }
  assert.deepEqual(store.list(target.root), [])
  const generated = store.saveGenerated(input, profile)
  const db = new DatabaseSync(file)
  try {
    const persisted = JSON.parse(db.prepare('SELECT content FROM person_profiles').get().content)
    assert.deepEqual(persisted.profile.sections, {
      基础信息: [], 性格与行为: [], 兴趣爱好: [], 其他: profile.observations,
    })
    assert.equal(persisted.profile.observations, undefined)
  } finally { db.close() }
  const reopened = new PersonProfileStore(file)
  assert.deepEqual(reopened.list(target.root), [generated])
  assert.deepEqual(reopened.list('second-fixture-account'), [])
  const patch = {
    root: target.root, id: generated.id, revision: generated.revision,
    name: '编辑后的名称', sections: { 基础信息: '', 性格与行为: '', 兴趣爱好: '新兴趣', 其他: '新正文' },
  }
  assert.throws(() => reopened.edit({ ...patch, root: 'second-fixture-account' }), /画像已更新/)
  assert.throws(() => reopened.edit({ ...patch, sections: {} }), /画像修改无效/)
  const edited = reopened.edit(patch)
  assert.throws(() => reopened.edit(patch), /画像已更新/)
  assert.deepEqual(new PersonProfileStore(file).list(target.root), [edited])
  assert.equal(edited.name, patch.name)
  assert.deepEqual(edited.profile.observations, [
    { category: '兴趣爱好', detail: '新兴趣', references: [] },
    { category: '其他', detail: '新正文', references: [1] },
  ])
  assert.deepEqual(edited.profile.evidence, profile.evidence)
  const cleared = reopened.edit({
    ...patch, revision: edited.revision, name: '',
    sections: { 基础信息: '', 性格与行为: '', 兴趣爱好: '', 其他: '' },
  })
  assert.equal(cleared.name, edited.name)
  assert.deepEqual(cleared.profile.observations, [])
  assert.deepEqual(new PersonProfileStore(file).list(target.root), [cleared])
  const regenerated = reopened.saveGenerated(input, profile)
  assert.equal(regenerated.id, edited.id)
  assert.deepEqual(reopened.list(target.root), [regenerated])
  const legacy = new DatabaseSync(file)
  try {
    legacy.prepare('UPDATE person_profiles SET content = ?').run(JSON.stringify({
      ...regenerated, profile: { ...profile, observations: [{ ...profile.observations[0], category: '沟通方式', title: '旧标题' }] },
    }))
  } finally { legacy.close() }
  assert.deepEqual(reopened.list(target.root), [regenerated])
  console.log('人物画像持久化测试通过')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
