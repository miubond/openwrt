import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rpcd = readFileSync(
  resolve(__dirname, '../../packages/mp716-rpc/files/usr/libexec/rpcd/mp716'),
  'utf8',
)

describe('rpcd/mp716 ubus routing [static]', () => {
  it('uses argv method name on call, not HTTP method field', () => {
    expect(rpcd).toMatch(/let name = arg\(1\)/)
    expect(rpcd).not.toMatch(/let name = req\?\.method/)
  })

  it('exports ucode plugin table for rpcd-mod-ucode', () => {
    expect(rpcd).toContain('return {')
    expect(rpcd).toContain('wireless:')
    expect(rpcd).toContain('hosts:')
  })
})
