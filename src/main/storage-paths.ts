import path from 'node:path'
export function applicationStorageRoot(): string {
  const root = process.env.WETRACE_STORAGE_ROOT
  if (!root) throw new Error('应用数据目录未初始化')
  return root
}
export function reportDirectory(): string { return path.join(applicationStorageRoot(), 'reports') }
