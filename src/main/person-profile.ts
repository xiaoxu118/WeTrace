import { listModelConfigs, resolveReportModel } from './model-config-store'
import { callReportModel, ModelContextLimitError } from './report-model'
import { createPersonProfileReader } from './wechat'
import { buildPersonProfile } from './person-profile-pipeline'
import type { PersonProfile, PersonProfileTarget } from '../shared/person-profile'

export async function generatePersonProfile(target: PersonProfileTarget, signal: AbortSignal, onProgress: (detail: string) => void): Promise<PersonProfile> {
  const models = listModelConfigs().filter(item => item.kind === 'text' && item.source === 'remote')
  const model = resolveReportModel((models.find(item => item.isDefault) ?? models[0])?.id ?? '', 'text')
  return buildPersonProfile(
    createPersonProfileReader(target),
    prompt => callReportModel(model, prompt, undefined, { signal, maxTokens: 4000, continueOnLength: true }),
    error => error instanceof ModelContextLimitError,
    signal,
    onProgress,
  )
}
