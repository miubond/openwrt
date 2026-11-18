import { DeviceRouterAdapter } from './adapters/device-adapter'
import { currentSessionToken } from './session'
import type { RouterAPI } from './router-api'

/** The installed OpenWrt firmware uses native authenticated ucode endpoints. */
export function createRouterApi(): RouterAPI {
  if (import.meta.env.VITE_ROUTER_ADAPTER === 'mock') {
    throw new Error('[mp716] 生产构建禁止使用 Mock 适配器，请使用原生设备接口')
  }
  return new DeviceRouterAdapter(currentSessionToken)
}
