export function normalizeKey(value: string): string {
  return value.trim().replace(/^0x/i, '').toLowerCase()
}

export function isValidDatabaseKey(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(normalizeKey(value))
}
