const IPV4 =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/
const MAC = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/

export function isIpv4(v: string): boolean {
  return IPV4.test(v.trim())
}

export function isMac(v: string): boolean {
  return MAC.test(v.trim())
}

export function isPort(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 65535
}

/** @deprecated Prefer requiredKey + i18n; emptySuffix must be provided by caller locale. */
export function required(v: string, label: string, emptySuffix: string): string | null {
  if (!v.trim()) return `${label}${emptySuffix}`
  return null
}

export function requiredKey(
  v: string,
  t: (key: string, params?: Record<string, unknown>) => string,
  label: string,
): string | null {
  if (!v.trim()) return t('validation.required', { label })
  return null
}
