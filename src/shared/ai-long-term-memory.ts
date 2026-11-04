export interface AiLongTermMemory { enabled: boolean; entries: { id: string; content: string }[] }
export type AiMemoryAction = { type: 'load' } | { type: 'add'; content: string } | { type: 'delete'; id: string } | { type: 'clear' } | { type: 'enable'; enabled: boolean }
export type AiMemoryResponse = { ok: true; memory: AiLongTermMemory } | { ok: false; error: string }
