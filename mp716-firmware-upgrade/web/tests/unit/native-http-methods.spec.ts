import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceRouterAdapter } from '@/api/adapters/device-adapter'
const adapter = new DeviceRouterAdapter(() => 'fixture-session')
const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, data: { accepted: true, rollbackSec: 0 } }) })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())
const mutations: [keyof DeviceRouterAdapter, string, unknown[]][] = [
  ['login', 'auth/login', [{ username: 'admin', password: 'fixture' }]],
  ['logout', 'auth/logout', []],
  ['applyQuickSetting', 'wizard/quick', [{}, {}]],
  ['completeWizardFirstBoot', 'wizard/complete', []],
  ['updateWanConfig', 'network/wan/config', [{}]],
  ['updateLanConfig', 'network/lan/config', [{}]],
  ['updateDhcpConfig', 'network/dhcp/config', [{}]],
  ['updateDhcpStaticBindings', 'network/dhcp/static', [[]]],
  ['updateDnsConfig', 'network/dns/config', [{}]],
  ['updateWifiConfig', 'wireless/config', [{}]],
  ['updateWifiAdvanced', 'wireless/advanced', [{}]],
  ['updatePptpClient', 'vpn/pptp', [{}]],
  ['updatePptpServer', 'vpn/pptpd', [{}]],
  ['updateL2tpServer', 'vpn/xl2tpd', [{}]],
  ['updateVpnUsers', 'vpn/users', [{}]],
  ['updateL2tpClient', 'vpn/xl2tp', [{}]],
  ['disconnectVpnUser', 'vpn/online/disconnect', ['1234']],
  ['updateOpenVpn', 'vpn/openvpn', [{}]],
  ['updateWirelessAcl', 'wireless/acl', [{}]],
  ['addDeviceAcl', 'hosts/device-acl', ['02:00:00:00:00:01']],
  ['removeDeviceAcl', 'hosts/device-acl', ['02:00:00:00:00:01']],
  ['disconnectDevice', 'hosts/disconnect', ['02:00:00:00:00:01']],
  ['updateFirewallRules', 'firewall/rules', [[]]],
  ['updatePortForwards', 'firewall/port-forwards', [[]]],
  ['updateQosConfig', 'network/qos/config', [{}]],
  ['runDiagnostic', 'tools/diagnostic', [{}]],
  ['startDiagnostic', 'tools/diagnostic/start', [{}]],
  ['pollDiagnostic', 'tools/diagnostic/poll', ['ping']],
  ['stopDiagnostic', 'tools/diagnostic/stop', ['ping']],
  ['changeAdminPassword', 'system/password', [{}]],
  ['updateSystemTime', 'system/time', [{}]],
  ['useBrowserTime', 'system/time/browser', ['2026-11-18 21:00:00']],
  ['updateScheReboot', 'system/sche-reboot', [{}]],
  ['applyFirmwareV2', 'system/firmware-v2/apply', []],
  ['updateSyslog', 'system/logs', [false]],
  ['clearSyslog', 'system/logs/clear', []],
  ['backupConfig', 'system/backup', []],
  ['downloadBackup', 'system/backup/download', []],
  ['confirmConfigTask', 'system/config-task/confirm', ['fixture-task']],
  ['cancelConfigTask', 'system/config-task/cancel', ['fixture-task']],
  ['rebootDevice', 'system/reboot', []],
  ['factoryReset', 'system/factory-reset', [{ confirmToken: 'fixture' }]],
]
describe('native adapter actual HTTP mutation methods', () => {
  it.each(mutations)('%s sends POST to %s through the real JSON transport', async (method, path, args) => {
    await Reflect.apply(adapter[method] as (...params: unknown[]) => unknown, adapter, args)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/cgi-bin/mp716/' + path, expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer fixture-session', 'Content-Type': 'application/json' }), body: expect.any(String) }))
  })
  it('sends an empty JSON object when clearing logs and leaves reading logs as GET', async () => {
    await adapter.clearSyslog()
    expect(fetchMock.mock.calls[0]![1].body).toBe('{}')
    fetchMock.mockClear(); await adapter.getSystemLogs(100)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/cgi-bin/mp716/system/logs?limit=100', expect.objectContaining({ method: 'GET', body: undefined }))
  })
})
