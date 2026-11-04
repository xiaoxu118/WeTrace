// Synthetic fixtures only. Windows native integration and real model tone checks are separate.
import { spawnSync } from 'node:child_process'
const logic = [
  'test-ai-long-term-memory.mjs', 'test-ai-evidence.mjs', 'test-ai-context.mjs',
  'test-ai-reduction.mjs', 'test-ai-prompts.mjs', 'test-ai-chat-history-store.mjs',
  'test-ai-chat-jobs.mjs', 'test-ai-cancellation.mjs', 'test-report-history.mjs',
  'test-wechat-platform.mjs', 'test-speech-stats.mjs', 'test-native-statistics.mjs',
]
const ui = [
  'test-p0-ai-ui.cjs', 'test-ai-memory-ui.cjs', 'test-ai-parallel-chats-ui.cjs',
  'test-report-generation.cjs', 'test-report-ui.cjs', 'test-unsupported-platform-ui.cjs',
]
for (const args of [
  ...logic.map(file => ['--experimental-strip-types', `scripts/${file}`]),
  ...ui.map(file => ['scripts/run-electron.mjs', 'exec', `scripts/${file}`]),
]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log('P0 自动化回归全部通过（模拟数据与模型，不包含 Windows 真机和真实模型语气验收）')
