import { describe, expect, it } from 'vitest'
import { validateNativeHost, validateNativeSource } from './native-detect-input'
import { validateHost, validateSource } from './detect-input'
const t = (key: string) => key

describe('native diagnostic input contract', () => {
  it.each(['127.0.0.1', '192.168.199.1', 'example.org', 'router', 'VPN.Example.org'])('accepts native host %s', host => {
    expect(validateNativeHost(host, t)).toBe('')
  })
  it.each(['https://example.org/path', 'example.org:443', 'example.org/path', '--help', '127.0.0.1;reboot', '999.168.1.1', 'a'.repeat(64) + '.org'])('rejects non-host target %s', host => {
    expect(validateNativeHost(host, t)).toBe('validation.detect.nativeHostFormat')
  })
  it('permits automatic source selection but requires IPv4 when provided', () => {
    expect(validateNativeSource('', t)).toBe('')
    expect(validateNativeSource(' 192.168.199.1 ', t)).toBe('')
    expect(validateNativeSource('example.org', t)).toBe('validation.detect.nativeSourceFormat')
    expect(validateNativeSource('999.1.1.1', t)).toBe('validation.detect.nativeSourceFormat')
  })
  it('keeps original firmware validation behavior independent', () => {
    expect(validateHost('example.org:443', t)).toBe('')
    expect(validateSource('', t)).toBe('validation.detect.sourceRequired')
  })
})
