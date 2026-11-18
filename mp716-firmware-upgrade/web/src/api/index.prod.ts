import { createRouterApi } from './create-router-api.prod'
import type { RouterAPI } from './router-api'

export type AdapterKind = 'device'

export { currentSessionToken, setRouterApiTokenGetter } from './session'

export { createRouterApi }

export const routerApi = createRouterApi()

export function getRouterApi(): RouterAPI {
  return routerApi
}

export function getApiMode(): AdapterKind {
  return 'device'
}

export * from './router-api'
export * from './types'
export * from './result'
