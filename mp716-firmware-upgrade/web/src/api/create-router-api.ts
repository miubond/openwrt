import { FactoryCgiAdapter } from './adapters/factory-cgi-adapter'
import { createMockRouterApi } from './mock-loader'
import type { RouterAPI } from './router-api'
type DevAdapterKind = 'mock' | 'factory'

function authBypassEnabled() {
  return import.meta.env.DEV && import.meta.env.VITE_AUTH_BYPASS === '1'
}

function resolveAdapterKind(): DevAdapterKind {
  const configured = import.meta.env.VITE_ROUTER_ADAPTER as string | undefined
  if (authBypassEnabled()) return 'mock'
  return configured === 'factory' ? 'factory' : 'mock'
}

export function createRouterApi(): RouterAPI {
  if (resolveAdapterKind() === 'factory') return new FactoryCgiAdapter()
  return createMockRouterApi()
}
