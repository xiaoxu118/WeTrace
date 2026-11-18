import path from 'node:path'
import { applicationStorageRoot } from './storage-paths'
export function getCacheDirectory(): string { return path.join(applicationStorageRoot(), 'cache') }
