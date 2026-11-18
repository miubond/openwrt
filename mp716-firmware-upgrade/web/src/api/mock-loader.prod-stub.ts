import type { RouterAPI } from './router-api'

export function createMockRouterApi(): RouterAPI {
  throw new Error('生产构建不包含 Mock 适配器')
}
