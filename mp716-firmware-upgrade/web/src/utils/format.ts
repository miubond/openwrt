export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** 对齐原厂首页速率：1024 进制，保留 1 位小数，单位紧贴数字 */
export function formatRate(bps: number): string {
  const parts = formatRateParts(bps)
  if (parts.value === '—') return '—'
  return `${parts.value}${parts.unit}`
}

export function formatRateParts(bps: number): { value: string; unit: string } {
  if (!Number.isFinite(bps) || bps < 0) return { value: '—', unit: '' }
  const trim1 = (n: number) => {
    const t = n.toFixed(4)
    return t.substring(0, t.lastIndexOf('.') + 2)
  }
  if (bps < 1024) return { value: String(bps), unit: 'bps' }
  if (bps < 1048576) return { value: trim1(bps / 1024), unit: 'Kbps' }
  if (bps < 1073741824) return { value: trim1(bps / 1024 / 1024), unit: 'Mbps' }
  return { value: trim1(bps / 1024 / 1024 / 1024), unit: 'Gbps' }
}

type Translate = (key: string) => string

/** 对齐原厂运行时长：42分52秒 / 1时2分3秒 / 1天0时42分52秒 */
export function formatUptime(sec: number, t?: Translate): string {
  const s = Math.max(0, Math.floor(sec))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const day = t?.('common.day') ?? '天'
  const hour = t?.('common.hour') ?? '时'
  const minute = t?.('common.minute') ?? '分'
  const second = t?.('common.second') ?? '秒'
  if (d > 0) return `${d}${day}${h}${hour}${m}${minute}${r}${second}`
  if (h > 0) return `${h}${hour}${m}${minute}${r}${second}`
  if (m > 0) return `${m}${minute}${r}${second}`
  return `${r}${second}`
}

export function formatPercent(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—'
  return `${Math.round(n)}%`
}

export function memoryUsedPercent(total: number, free: number): number {
  if (!total) return 0
  return ((total - free) / total) * 100
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function stampLocal(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/** 对齐原厂：YYYY-MM-DD HH:mm:ss。已是该形式的字符串保持原样，ISO / Unix 转为本地时间。 */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '—' : stampLocal(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return '—'
    const ms = value > 1e12 ? value : value * 1000
    return stampLocal(new Date(ms))
  }
  const text = value.trim()
  if (!text) return '—'
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text)) return text
  if (/^\d+$/.test(text)) return formatDateTime(Number(text))
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  return stampLocal(date)
}
