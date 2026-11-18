import type { WifiConfig, WifiMode, WifiSecurity, WifiTxPowerPercent } from './types'

/** UI 加密选项 → 契约 security */
export function encryptionToSecurity(encryption: string): WifiSecurity {
  switch (encryption) {
    case 'unsupported':
      return 'unsupported'
    case 'none':
      return 'none'
    case 'wpapsk':
      return 'wpa-psk'
    case 'wpa2psk':
    case 'psk2':
      return 'wpa2-psk'
    case 'wpapskwpa2psk':
      return 'wpa-wpa2-psk'
    case 'sae':
      return 'wpa3-sae'
    case 'psk2+sae':
      return 'wpa2-wpa3'
    default:
      return 'wpa2-psk'
  }
}

export function securityToEncryption(security: WifiSecurity): string {
  switch (security) {
    case 'unsupported':
      return 'unsupported'
    case 'none':
      return 'none'
    case 'wpa-psk':
      return 'wpapsk'
    case 'wpa2-psk':
      return 'wpa2psk'
    case 'wpa-wpa2-psk':
      return 'wpapskwpa2psk'
    case 'wpa3-sae':
      return 'sae'
    case 'wpa2-wpa3':
      return 'psk2+sae'
    default:
      return 'wpa2psk'
  }
}

export interface WifiBasicForm {
  enabled: boolean
  ssid: string
  password: string
  encryption: string
  cipher: 'tkip' | 'aes' | 'tkipaes'
  channel: number | 'auto'
  htmode: 'AUTO' | 'HT20' | 'HT40'
  mode: WifiMode
  supportedModes?: WifiMode[]
  rawEncryption?: string
  txpowerPercent: WifiTxPowerPercent
  maxClients: number
  isolate: boolean
  hidden: boolean
  macfilter: 'disable' | 'allow' | 'deny'
  maclist: string[]
}

export function wifiConfigToForm(cfg: WifiConfig): WifiBasicForm {
  return {
    enabled: cfg.enabled,
    ssid: cfg.ssid,
    password: cfg.password || '',
    encryption: securityToEncryption(cfg.security),
    cipher: cfg.cipher || 'aes',
    channel: cfg.channel,
    htmode: cfg.htmode || 'AUTO',
    mode: cfg.mode || '11bgn',
    supportedModes: cfg.supportedModes,
    rawEncryption: cfg.rawEncryption,
    txpowerPercent: (cfg.txpowerPercent ?? cfg.txPower ?? 100) as WifiTxPowerPercent,
    maxClients: cfg.maxClients ?? 32,
    isolate: Boolean(cfg.isolate),
    hidden: cfg.hidden,
    macfilter: cfg.macfilter || 'disable',
    maclist: cfg.maclist ? [...cfg.maclist] : [],
  }
}

export function formToWifiConfig(form: WifiBasicForm): WifiConfig {
  return {
    enabled: form.enabled,
    ssid: form.ssid,
    password: form.password,
    hidden: form.hidden,
    channel: form.channel,
    txPower: form.txpowerPercent,
    security: encryptionToSecurity(form.encryption),
    cipher: form.cipher,
    mode: form.mode,
    htmode: form.htmode,
    txpowerPercent: form.txpowerPercent,
    maxClients: form.maxClients,
    isolate: form.isolate,
    macfilter: form.macfilter,
    maclist: form.maclist,
  }
}
