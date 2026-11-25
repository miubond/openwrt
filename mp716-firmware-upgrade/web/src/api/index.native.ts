import { createRouterApi } from './create-native-api'
import type { RouterAPI } from './router-api'

export type AdapterKind = 'device'

export {
  currentSessionToken,
  notifySessionInvalid,
  setRouterApiTokenGetter,
  setSessionInvalidHandler,
  setSessionActiveHandler,
} from './session'

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
