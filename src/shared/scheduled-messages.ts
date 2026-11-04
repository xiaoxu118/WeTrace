export type SendTaskStatus = 'draft' | 'scheduled' | 'paused' | 'sending' | 'sent' | 'failed' | 'unknown' | 'cancelled'
export interface SendTask { id: string; recipientId: string; recipientName: string; content: string; dueAt: number; status: SendTaskStatus; createdAt: number; updatedAt: number; receipt?: string; logs: { at: number; detail: string }[] }
export interface SendTaskState { enabled: boolean; tasks: SendTask[] }
export interface SendCapability { supported: boolean; reason?: string }
export type SendTaskAction = { type: 'load' } | { type: 'enable'; enabled: boolean } | { type: 'create'; recipientId: string; content: string; dueAt: number } | { type: 'confirm' | 'pause' | 'resume' | 'cancel'; id: string }
export type SendTaskResponse = { ok: true; state: SendTaskState; capability: SendCapability } | { ok: false; error: string }
