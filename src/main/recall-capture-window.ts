/** Bounded incremental capture; a cold start does not scan unbounded history. */
export function recallCaptureWindow<T extends { createTime: number }>(read: (limit: number, offset: number) => T[], checkedAt?: number): { rows: T[]; truncated: boolean } {
  if (checkedAt === undefined) return { rows: read(60, 0), truncated: false }
  const rows: T[] = []
  for (let offset = 0; offset < 5000; offset += 200) {
    const page = read(200, offset)
    rows.push(...page)
    if (page.length < 200 || page.some(row => row.createTime * 1000 < checkedAt - 120000)) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}
