export const DEFAULT_IMAGE_CONCURRENCY = 3
export const MAX_IMAGE_CONCURRENCY = 16

export function imageConcurrency(value?: number): number {
  if (value === undefined) return DEFAULT_IMAGE_CONCURRENCY
  if (!Number.isInteger(value) || value < 1 || value > MAX_IMAGE_CONCURRENCY) throw new Error(`图片线程数须为 1–${MAX_IMAGE_CONCURRENCY} 的整数`)
  return value
}

/** Stop scheduling after a failure, but allow in-flight work to finish saving its cache. */
export async function processConcurrent<T>(items: readonly T[], concurrency: number, process: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0
  let failed = false
  let failure: unknown
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++
      try { await process(items[index], index) }
      catch (error) { if (!failed) { failed = true; failure = error } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  if (failed) throw failure
}
