let tokenGetter: () => string | null = () => null
let sessionInvalidHandler: (() => void) | null = null

export function setRouterApiTokenGetter(getter: () => string | null): void {
  tokenGetter = getter
}

export function setSessionInvalidHandler(handler: (() => void) | null): void {
  sessionInvalidHandler = handler
}

export function notifySessionInvalid(): void {
  sessionInvalidHandler?.()
}

let sessionActiveHandler: (() => void) | null = null

export function setSessionActiveHandler(handler: (() => void) | null): void {
  sessionActiveHandler = handler
}

/** 设备鉴权接口成功即证明会话有效（rpcd 同时续期），路由守卫可免 ping */
export function notifySessionActive(): void {
  sessionActiveHandler?.()
}

export function currentSessionToken(): string | null {
  return tokenGetter()
}
