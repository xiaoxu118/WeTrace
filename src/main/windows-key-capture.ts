import koffi from 'koffi'
import path from 'node:path'
import { isValidDatabaseKey } from '../shared/database-key-format'

export interface KeyHook {
  initialize(pid: number): boolean
  poll(buffer: Buffer, size: number): boolean
  cleanup(): boolean
}

// Serialized because the native hook owns process-global state.
let capturing = false
let library: ReturnType<typeof koffi.load> | undefined

export async function pollWindowsKey(hook: KeyHook, pid: number, onReady?: () => void, timeout = 120_000): Promise<string> {
  try {
    if (!hook.initialize(pid)) throw new Error('无法连接微信进程，请检查应用与微信的运行权限')
    onReady?.()
    const deadline = Date.now() + timeout
    const buffer = Buffer.alloc(128)
    while (Date.now() < deadline) {
      buffer.fill(0)
      if (hook.poll(buffer, buffer.length)) {
        const key = buffer.toString('utf8').split('\0')[0].trim()
        if (isValidDatabaseKey(key)) return key.toLowerCase()
      }
      await new Promise(resolve => setTimeout(resolve, 120))
    }
    throw new Error('等待微信登录超时，请重新获取密钥')
  } finally {
    hook.cleanup()
  }
}

export async function captureWindowsKey(dll: string, pid: number, onReady?: () => void): Promise<string> {
  if (capturing) throw new Error('正在获取密钥，请等待当前任务完成')
  capturing = true
  try {
    const directory = path.dirname(dll)
    if (!process.env.PATH?.split(path.delimiter).includes(directory)) process.env.PATH = `${directory}${path.delimiter}${process.env.PATH ?? ''}`
    library ??= koffi.load(dll)
    const hook: KeyHook = {
      initialize: library.func('bool InitializeHook(uint32 targetPid)') as KeyHook['initialize'],
      poll: library.func('bool PollKeyData(_Out_ char* keyBuffer, int bufferSize)') as KeyHook['poll'],
      cleanup: library.func('bool CleanupHook()') as KeyHook['cleanup'],
    }
    return await pollWindowsKey(hook, pid, onReady)
  } finally {
    capturing = false
  }
}
