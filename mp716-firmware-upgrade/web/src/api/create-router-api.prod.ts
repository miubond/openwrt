import { FactoryCgiAdapter } from './adapters/factory-cgi-adapter'
import type { RouterAPI } from './router-api'

/** 生产 / mp716-test 构建：仅 FactoryCgiAdapter（华翼 CGI） */
export function createRouterApi(): RouterAPI {
  if (import.meta.env.VITE_ROUTER_ADAPTER === 'mock') {
    throw new Error('[mp716] 生产构建禁止使用 Mock 适配器，请使用原厂 CGI 适配器')
  }
  return new FactoryCgiAdapter()
}
