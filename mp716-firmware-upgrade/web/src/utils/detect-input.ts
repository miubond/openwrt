/** 原厂 simple-react-validator 的 url 规则，IP 与域名都走这一条。 */
const HOST_RE =
  /^(?=^.{3,255}$)(www\.)?[a-zA-Z0-9][-a-zA-Z0-9]{0,62}(\.[a-zA-Z0-9][-a-zA-Z0-9]{0,62})+((\/)*([a-zA-Z0-9][-a-zA-Z0-9]{0,62})?)+(:\d+)*(\/\w+\.\w+)*([?&]\w+=\w*)*$/

type Translate = (key: string) => string

export function validateHost(value: string, t: Translate): string {
  const host = value.trim()
  if (!host) return t('validation.detect.hostRequired')
  if (!HOST_RE.test(host)) return t('validation.detect.hostFormat')
  if (host.length > 63) return t('validation.detect.hostMaxLen')
  return ''
}

export function validateSource(value: string, t: Translate): string {
  const source = value.trim()
  if (!source) return t('validation.detect.sourceRequired')
  if (source.length > 63) return t('validation.detect.sourceMaxLen')
  return ''
}

export function validateRange(
  value: string,
  min: number,
  max: number,
  emptyMessage: string,
  rangeMessage: string,
): string {
  const raw = value.trim()
  if (!raw) return emptyMessage
  if (!/^\d+$/.test(raw)) return rangeMessage
  const number = Number(raw)
  if (number < min || number > max) return rangeMessage
  return ''
}
