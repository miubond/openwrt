import { MockRouterAdapter } from './adapters/mock-adapter'
import type { RouterAPI } from './router-api'

export function createMockRouterApi(): RouterAPI {
  return new MockRouterAdapter()
}
