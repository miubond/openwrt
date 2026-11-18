import { createRouterApi } from './create-router-api.prod'
import type { RouterAPI } from './router-api'

export type AdapterKind = 'mock' | 'factory'

let tokenGetter: () => string | null = () => null

export function setRouterApiTokenGetter(getter: () => string | null): void {
  tokenGetter = getter
}

export function currentSessionToken(): string | null {
  return tokenGetter()
}

export { createRouterApi }

export const routerApi = createRouterApi()

export function getRouterApi(): RouterAPI {
  return routerApi
}

export function getApiMode(): AdapterKind {
  return 'factory'
}

export * from './router-api'
export * from './types'
export * from './result'
