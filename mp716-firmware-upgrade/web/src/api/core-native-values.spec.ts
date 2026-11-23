import { expect, it } from 'vitest'
import { toSystemStatusView } from './view-map'
import { formToWifiConfig, wifiConfigToForm } from './wifi-map'
import { formatDateTime } from '@/utils/format'
import type { SystemInfo, SystemStatus, WifiConfig } from './types'
const info: SystemInfo = { model: 'MP716', hostname: 'fixture', firmware: '1.0.4', kernel: '6.12', uptimeSec: 30, localTime: '2026-11-18 21:00:00', timezone: 'CST-8', cpuLoad: [1.2, 0.6, 0.4], memTotalKb: 64000, memFreeKb: 12000, flashTotalKb: 8192, flashFreeKb: 1000 }
const status: SystemStatus = { cpuPercent: null, cpuSampled: false, memoryPercent: 80, uptimeSec: 30, interfaces: [], wirelessClients: 0, wiredClients: 1 }
it('keeps an unsampled CPU unknown instead of using load average or zero', () => {
  expect(toSystemStatusView(info, status).cpu?.usagePercent).toBeUndefined()
  expect(toSystemStatusView(info, { ...status, cpuPercent: 0, cpuSampled: true }).cpu?.usagePercent).toBe(0)
  expect(toSystemStatusView(info, { ...status, cpuPercent: 31, cpuSampled: true }).cpu?.usagePercent).toBe(31)
})
it('keeps factory status without a sampling flag compatible', () => {
  expect(toSystemStatusView(info, { ...status, cpuPercent: 0, cpuSampled: undefined }).cpu?.usagePercent).toBe(0)
})
it('displays device local wall clock without converting it through browser timezone', () => {
  const view = toSystemStatusView(info, status)
  expect(view.time.timezone).toBe('CST-8')
  expect(formatDateTime(view.time.local)).toBe('2026-11-18 21:00:00')
})
it.each(['unsupported', 'wpa3-sae', 'wpa2-wpa3', 'wpa-wpa2-psk'] as const)('preserves %s security on an unrelated edit', security => {
  const cfg: WifiConfig = { enabled: true, ssid: 'fixture', hidden: false, channel: 6, txPower: 100, security, password: '********', cipher: 'tkipaes', mode: '11gn', rawEncryption: 'fixture-encryption', supportedModes: ['11g', '11n', '11bg', '11bgn'] }
  const form = wifiConfigToForm(cfg); form.ssid = 'renamed'
  const submitted = formToWifiConfig(form)
  expect(submitted).toMatchObject({ ssid: 'renamed', security, password: '********', cipher: 'tkipaes', mode: '11gn' })
  expect(form.rawEncryption).toBe(cfg.rawEncryption)
  expect(form.supportedModes).toEqual(cfg.supportedModes)
})
