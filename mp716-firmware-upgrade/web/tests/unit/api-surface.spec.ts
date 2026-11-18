import { describe, expect, it } from 'vitest'
import { DeviceRouterAdapter } from '@/api/adapters/device-adapter'
import { FactoryCgiAdapter } from '@/api/adapters/factory-cgi-adapter'
import { MockRouterAdapter } from '@/api/adapters/mock-adapter'
import type { RouterAPI } from '@/api/router-api'

const requiredKeys: (keyof RouterAPI)[] = [
  'login',
  'getSystemInfo',
  'getWanConfig',
  'updateWanConfig',
  'getDhcpConfig',
  'getWirelessAcl',
  'updatePortForwards',
  'getQosCapability',
  'getQosConfig',
  'updateQosConfig',
  'runDiagnostic',
  'changeAdminPassword',
  'getFirmwareInfo',
  'uploadFirmware',
  'downloadBackup',
  'getConfigTaskStatus',
  'confirmConfigTask',
  'disconnectDevice',
  'factoryReset',
]

function assertSurface(api: object) {
  for (const key of requiredKeys) {
    expect(typeof (api as RouterAPI)[key]).toBe('function')
  }
}

describe('RouterAPI surface parity', () => {
  it('mock adapter implements contract', () => {
    assertSurface(new MockRouterAdapter())
  })

  it('device adapter implements contract', () => {
    assertSurface(new DeviceRouterAdapter(() => null))
  })

  it('factory cgi adapter implements contract', () => {
    assertSurface(new FactoryCgiAdapter())
  })
})
