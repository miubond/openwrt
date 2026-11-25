import { DeviceRouterAdapter } from './adapters/device-adapter'
import { FactoryCgiAdapter } from './adapters/factory-cgi-adapter'
import { createMockRouterApi } from './mock-loader'
import { currentSessionToken } from './session'
import type { RouterAPI } from './router-api'

type DevAdapterKind = 'mock' | 'factory' | 'device'

function authBypassEnabled() {
  return import.meta.env.DEV && import.meta.env.VITE_AUTH_BYPASS === '1'
}

function resolveAdapterKind(): DevAdapterKind {
  const configured = import.meta.env.VITE_ROUTER_ADAPTER as string | undefined
  if (authBypassEnabled()) return 'mock'
  if (configured === 'factory') return 'factory'
  if (configured === 'device') return 'device'
  return 'mock'
}

export function createRouterApi(): RouterAPI {
  const kind = resolveAdapterKind()
  if (kind === 'factory') return new FactoryCgiAdapter()
  if (kind === 'device') return new DeviceRouterAdapter(currentSessionToken)
  return createMockRouterApi()
}
