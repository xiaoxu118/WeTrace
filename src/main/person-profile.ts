import { setTimeout as delay } from 'node:timers/promises'
import { listModelConfigs, resolveReportModel } from './model-config-store'
import { callReportModel, ModelContextLimitError } from './report-model'
import { loadProfileCheckpoint, removeProfileCheckpoint, saveProfileCheckpoint } from './person-profile-checkpoint-store'
import { createPersonProfileReader } from './wechat'
import { buildPersonProfile, type ProfileCheckpoint, type ProfileResponseMemo } from './person-profile-pipeline'
import { personProfileTargetKey } from '../shared/person-profile.ts'
import type { PersonProfile, PersonProfileTarget } from '../shared/person-profile'

const activeProfiles = new Set<string>()
const unfinishedProfiles = new Map<string, { modelKey: string; memo: ProfileResponseMemo; checkpoint: ProfileCheckpoint }>()

export function clearPersonProfileCheckpoint(target: PersonProfileTarget): void {
  const key = personProfileTargetKey(target)
  unfinishedProfiles.delete(key)
  removeProfileCheckpoint(key)
}

function createResponseMemo(): ProfileResponseMemo {
  const replies = new Map<string, string>()
  const maxChars = 4_000_000
  let chars = 0
  return {
    get: key => replies.get(key),
    set(key, response) {
      if (response.length > maxChars) return
      chars -= replies.get(key)?.length ?? 0
      replies.delete(key)
      while (chars + response.length > maxChars) {
        const oldest = replies.keys().next().value!
        chars -= replies.get(oldest)!.length
        replies.delete(oldest)
      }
      replies.set(key, response)
      chars += response.length
    },
  }
}

export async function generatePersonProfile(target: PersonProfileTarget, signal: AbortSignal, onProgress: (detail: string) => void): Promise<PersonProfile> {
  const models = listModelConfigs().filter(item => item.kind === 'text' && item.source === 'remote')
  const model = resolveReportModel((models.find(item => item.isDefault) ?? models[0])?.id ?? '', 'text')
  const read = createPersonProfileReader(target)
  const key = personProfileTargetKey(target)
  if (activeProfiles.has(key)) throw new Error('已有画像正在生成')
  const modelKey = JSON.stringify([model.id, model.baseUrl, model.apiFormat, model.model])
  const previous = unfinishedProfiles.get(key)
  const task = previous?.modelKey === modelKey ? previous : {
    modelKey, memo: createResponseMemo(), checkpoint: loadProfileCheckpoint(key, modelKey) ?? {},
  }
  unfinishedProfiles.delete(key)
  unfinishedProfiles.set(key, task)
  activeProfiles.add(key)
  signal.addEventListener('abort', read.close, { once: true })
  let warned = false
  const persist = () => {
    try { saveProfileCheckpoint(key, modelKey, task.checkpoint) }
    catch {
      if (!warned) onProgress('无法写入本地续接进度 · 本次进度暂存在内存')
      warned = true
    }
  }

  try {
    return await buildPersonProfile(
      async query => {
        for (let attempt = 0; ; attempt++) {
          signal.throwIfAborted()
          try {
            const page = await read(query)
            signal.throwIfAborted()
            return page
          } catch (error) {
            signal.throwIfAborted()
            const retryable = error instanceof Error && /读取微信记录超时|聊天读取进程已退出|本地数据库正被其他任务占用/.test(error.message)
            if (!retryable || attempt === 2) throw error
            onProgress(`读取微信记录暂时失败 · 正在重试 ${attempt + 1}/2`)
            await delay(500 * (attempt + 1), undefined, { signal })
          }
        }
      },
      prompt => callReportModel(model, prompt, undefined, { signal, maxTokens: 4000, continueOnLength: true }),
      error => error instanceof ModelContextLimitError,
      signal,
      onProgress,
      task.memo,
      task.checkpoint,
      persist,
    )
  } catch (error) {
    persist()
    throw error
  } finally {
    signal.removeEventListener('abort', read.close)
    read.close()
    activeProfiles.delete(key)
    const inactive = [...unfinishedProfiles.keys()].filter(key => !activeProfiles.has(key))
    for (const expired of inactive.slice(0, -3)) unfinishedProfiles.delete(expired)
  }
}
