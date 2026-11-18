import { describe, expect, it } from 'vitest'
import { isIpv4, isMac, isPort } from '@/utils/validate'

describe('validate', () => {
  it('accepts ipv4', () => {
    expect(isIpv4('192.168.1.1')).toBe(true)
    expect(isIpv4('256.1.1.1')).toBe(false)
  })
  it('accepts mac', () => {
    expect(isMac('aa:bb:cc:dd:ee:ff')).toBe(true)
    expect(isMac('aabbccddeeff')).toBe(false)
  })
  it('accepts ports', () => {
    expect(isPort(80)).toBe(true)
    expect(isPort(0)).toBe(false)
  })
})
