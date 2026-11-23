import { isIpv4 } from './validate'

type Translate = (key: string) => string

/** Native diagnostic commands accept a host, never an HTTP URL or options. */
export function validateNativeHost(value: string, t: Translate): string {
  const host = value.trim()
  if (!host) return t('validation.detect.hostRequired')
  if (host.length > 253) return t('validation.detect.nativeHostMaxLen')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return isIpv4(host) ? '' : t('validation.detect.nativeHostFormat')
  }
  const valid = host.split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))
  return valid ? '' : t('validation.detect.nativeHostFormat')
}

/** Empty selects the kernel's source address; explicit sources are checked
 * against actual local interface addresses by the native backend as well. */
export function validateNativeSource(value: string, t: Translate): string {
  const source = value.trim()
  return !source || isIpv4(source) ? '' : t('validation.detect.nativeSourceFormat')
}
