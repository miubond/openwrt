let tokenGetter: () => string | null = () => null

export function setRouterApiTokenGetter(getter: () => string | null): void {
  tokenGetter = getter
}

export function currentSessionToken(): string | null {
  return tokenGetter()
}
