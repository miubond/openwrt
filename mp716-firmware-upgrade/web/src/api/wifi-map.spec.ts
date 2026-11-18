import { expect, it } from 'vitest'
import { formToWifiConfig, wifiConfigToForm } from './wifi-map'
import type { WifiConfig } from './types'

it('preserves masked credentials and zero transmit power through the form', () => {
  const config: WifiConfig = { enabled: true, ssid: 'unchanged', hidden: false, channel: 6,
    txPower: 0, txpowerPercent: 0, security: 'wpa-wpa2-psk', password: '********' }
  const restored = formToWifiConfig(wifiConfigToForm(config))
  expect(restored.password).toBe('********')
  expect(restored.ssid).toBe(config.ssid)
  expect(restored.security).toBe(config.security)
  expect(restored.txPower).toBe(0)
})
