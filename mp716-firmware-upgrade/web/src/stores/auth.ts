import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  getRouterApi,
  setRouterApiTokenGetter,
  setSessionActiveHandler,
  setSessionInvalidHandler,
  toApiError,
  unwrap,
} from '@/api'

const TOKEN_KEY = 'mp716_session'
const TRUST_UNTIL_KEY = 'mp716_session_trusted_until'
/** 登录成功后短暂跳过 ping，避免刚进首页就被守卫打回登录页 */
const SESSION_TRUST_MS = 90_000
const isNativeDevice = import.meta.env.VITE_ROUTER_ADAPTER === 'device'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY))
  let sessionTrustedUntil = 0
  const loading = ref(false)
  const error = ref<string | null>(null)
  const firstBoot = ref(0)
  const needAuthorized = ref(1)
  const preLoginLoaded = ref(false)
  let preLoginPromise: Promise<void> | null = null
  let refreshPromise: Promise<boolean> | null = null

  const authenticated = computed(() => Boolean(token.value))

  setRouterApiTokenGetter(() => token.value)

  let invalidNavLock = false
  setSessionInvalidHandler(() => {
    if (!token.value) return
    setSession(null)
    if (invalidNavLock) return
    invalidNavLock = true
    const redirect =
      typeof window !== 'undefined' && window.location.hash.length > 1
        ? window.location.hash.slice(1)
        : '/'
    const login = `/#/login?expired=1&redirect=${encodeURIComponent(redirect)}`
    window.location.replace(login)
  })

  function markSessionEstablished() {
    sessionTrustedUntil = Date.now() + SESSION_TRUST_MS
    try {
      sessionStorage.setItem(TRUST_UNTIL_KEY, String(sessionTrustedUntil))
    } catch {
      /* private mode */
    }
  }

  setSessionActiveHandler(() => {
    if (token.value) markSessionEstablished()
  })

  function restoreSessionTrust() {
    if (sessionTrustedUntil > 0) return
    try {
      const raw = sessionStorage.getItem(TRUST_UNTIL_KEY)
      if (raw) sessionTrustedUntil = Number(raw) || 0
    } catch {
      /* ignore */
    }
  }

  function isSessionTrusted() {
    restoreSessionTrust()
    return Boolean(token.value) && Date.now() < sessionTrustedUntil
  }

  function setSession(value: string | null) {
    token.value = value
    if (value) {
      localStorage.setItem(TOKEN_KEY, value)
    } else {
      localStorage.removeItem(TOKEN_KEY)
      sessionTrustedUntil = 0
      try {
        sessionStorage.removeItem(TRUST_UNTIL_KEY)
      } catch {
        /* ignore */
      }
    }
  }

  async function loadPreLogin() {
    if (preLoginLoaded.value) return
    if (preLoginPromise) return preLoginPromise
    preLoginPromise = (async () => {
      try {
        /** 原生已登录会话无需再拉 prelogin，避免与首页 CGI 争抢 */
        if (isNativeDevice && token.value) {
          firstBoot.value = 0
          needAuthorized.value = 1
          return
        }
        const data = unwrap(await getRouterApi().getPreLoginConfig())
        firstBoot.value = data.firstBoot
        needAuthorized.value = data.needAuthorized
      } catch {
        firstBoot.value = 0
        needAuthorized.value = 1
      } finally {
        preLoginLoaded.value = true
        preLoginPromise = null
      }
    })()
    return preLoginPromise
  }

  function wizardWithoutLogin() {
    return firstBoot.value === 1 && needAuthorized.value === 0
  }

  function wizardAfterLogin() {
    return firstBoot.value === 1
  }

  function markWizardComplete() {
    firstBoot.value = 0
  }

  async function login(username: string, password: string) {
    loading.value = true
    error.value = null
    try {
      const res = await getRouterApi().login({ username, password })
      if (!res.ok) {
        error.value = res.message
        throw new Error(res.message)
      }
      setSession(res.data.token)
      markSessionEstablished()
    } catch (e) {
      setSession(null)
      if (!error.value) error.value = toApiError(e).message
      throw e
    } finally {
      loading.value = false
    }
  }

  async function logout() {
    try {
      await getRouterApi().logout()
    } finally {
      setSession(null)
    }
  }

  async function refreshSession() {
    if (!token.value) return false
    if (isSessionTrusted()) return true
    if (refreshPromise) return refreshPromise
    refreshPromise = (async () => {
      try {
        unwrap(await getRouterApi().ping())
        /** 与首页 getSystemInfo（同 HYID 107）错开重复等待：探测成功后短暂信任 */
        markSessionEstablished()
        return true
      } catch {
        setSession(null)
        return false
      } finally {
        refreshPromise = null
      }
    })()
    return refreshPromise
  }

  return {
    token,
    authenticated,
    loading,
    error,
    firstBoot,
    needAuthorized,
    preLoginLoaded,
    login,
    logout,
    refreshSession,
    isSessionTrusted,
    setSession,
    loadPreLogin,
    wizardWithoutLogin,
    wizardAfterLogin,
    markWizardComplete,
  }
})
