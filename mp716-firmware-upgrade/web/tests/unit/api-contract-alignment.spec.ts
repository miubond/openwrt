import { describe, expect, it } from 'vitest'
import { DEVICE_ADAPTER_SEGMENT, ROUTER_API_CONTRACT } from '@/api/contract-manifest'
import type { RouterAPI } from '@/api/router-api'

const requiredKeys: (keyof RouterAPI)[] = [
  'login',
  'logout',
  'ping',
  'getSystemInfo',
  'getDeviceInfo',
  'getSystemStatus',
  'getWanStatus',
  'getWanConfig',
  'updateWanConfig',
  'getLanStatus',
  'getLanConfig',
  'updateLanConfig',
  'getDhcpConfig',
  'updateDhcpConfig',
  'updateDhcpStaticBindings',
  'getDnsConfig',
  'updateDnsConfig',
  'getQosCapability',
  'getQosConfig',
  'updateQosConfig',
  'getWifiStatus',
  'getWifiConfig',
  'updateWifiConfig',
  'getWirelessClients',
  'getWirelessAcl',
  'updateWirelessAcl',
  'getConnectedDevices',
  'getDeviceAclList',
  'addDeviceAcl',
  'removeDeviceAcl',
  'disconnectDevice',
  'getFirewallRules',
  'updateFirewallRules',
  'getPortForwards',
  'updatePortForwards',
  'runDiagnostic',
  'getSystemLogs',
  'changeAdminPassword',
  'getSystemTime',
  'updateSystemTime',
  'getFirmwareInfo',
  'uploadFirmware',
  'restoreConfig',
  'backupConfig',
  'downloadBackup',
  'getConfigTaskStatus',
  'confirmConfigTask',
  'rebootDevice',
  'factoryReset',
  'getWireGuardClient',
  'updateWireGuardClient',
  'importWireGuardClient',
  'getWireGuardStatus',
]

describe('RouterAPI contract alignment [PC static]', () => {
  it('manifest covers every RouterAPI method', () => {
    const covered = new Set(
      ROUTER_API_CONTRACT.flatMap((r) => r.adapterMethod.split('|')),
    )
    for (const key of requiredKeys) {
      expect(covered.has(key), `missing manifest for ${key}`).toBe(true)
    }
  })

  it('device adapter paths match manifest', () => {
    for (const [method, segment] of Object.entries(DEVICE_ADAPTER_SEGMENT)) {
      const row = ROUTER_API_CONTRACT.find((r) => r.adapterMethod.split('|').includes(method))
      expect(row, method).toBeDefined()
      const base = segment.split('?')[0]
      if (base === 'system/config-task') {
        expect(['system/config-task', 'system/config-task/confirm'].some((p) => row!.path.startsWith('system/config-task'))).toBe(true)
      } else {
        expect(row!.path).toBe(base)
      }
    }
  })

})
