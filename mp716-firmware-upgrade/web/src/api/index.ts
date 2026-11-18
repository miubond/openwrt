import { createRouterApi as createRouterApiImpl } from './create-router-api'
import type { RouterAPI } from './router-api'

export type AdapterKind = 'mock' | 'factory'

/** 开发期临时绕过：登录放行 + 用 mock 填页面，避免未录制契约刷红错 */
function authBypassEnabled() {
  return import.meta.env.DEV && import.meta.env.VITE_AUTH_BYPASS === '1'
}

function resolveAdapterKind(): AdapterKind {
  const configured = import.meta.env.VITE_ROUTER_ADAPTER as string | undefined

  if (import.meta.env.PROD) {
    if (configured === 'mock') {
      throw new Error(
        '[mp716] 生产构建禁止使用 Mock 适配器，请使用原厂 CGI 适配器',
      )
    }
    return 'factory'
  }

  // bypass 开启时强制 mock，便于对齐菜单与表单；关闭 bypass 后仍可按配置走 factory
  if (authBypassEnabled()) return 'mock'

  return configured === 'factory' ? 'factory' : 'mock'
}

let tokenGetter: () => string | null = () => null

export function setRouterApiTokenGetter(getter: () => string | null): void {
  tokenGetter = getter
}

/** 留给已录制的原厂会话字段。当前生产适配器在契约录到之前不会发送它。 */
export function currentSessionToken(): string | null {
  return tokenGetter()
}

export function createRouterApi(): RouterAPI {
  return createRouterApiImpl()
}

export const routerApi = createRouterApi()

/** 兼容旧调用名 */
export function getRouterApi(): RouterAPI {
  return routerApi
}

/** UI 展示用：mock | factory */
export function getApiMode(): AdapterKind {
  return resolveAdapterKind()
}

export * from './router-api'
export * from './types'
export * from './result'
