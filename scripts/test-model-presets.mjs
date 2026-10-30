import assert from 'node:assert/strict'
import { modelPreset } from '../src/shared/model-presets.ts'
assert.deepEqual(modelPreset(), { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' })
assert.equal(modelPreset('DeepSeek', 'anthropic').baseUrl, 'https://api.deepseek.com/anthropic')
assert.equal(modelPreset('DeepSeek', 'openai', 'image').model, '')
assert.equal(modelPreset('DeepSeek', 'openai', 'speech').model, '')
assert.equal(modelPreset('自定义', 'anthropic').baseUrl, '')
console.log('模型模板自测通过：DeepSeek 默认值、两种协议与独立模型类型。')
