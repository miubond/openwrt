import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getRouterApi, setRouterApiTokenGetter, toApiError, unwrap } from '@/api'

const TOKEN_KEY = 'mp716_session'
/** 登录成功后短暂跳过 ping，避免刚进首页就被守卫打回登录页 */
const SESSION_TRUST_MS = 120_000

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY))
  let sessionTrustedUntil = 0
  const loading = ref(false)
  const error = ref<string | null>(null)
  const firstBoot = ref(0)
  const needAuthorized = ref(1)
  const preLoginLoaded = ref(false)

  const authenticated = computed(() => Boolean(token.value))

  setRouterApiTokenGetter(() => token.value)

  function markSessionEstablished() {
    sessionTrustedUntil = Date.now() + SESSION_TRUST_MS
  }

  function isSessionTrusted() {
    return Boolean(token.value) && Date.now() < sessionTrustedUntil
  }

  function setSession(value: string | null) {
    token.value = value
    if (value) {
      localStorage.setItem(TOKEN_KEY, value)
    } else {
      localStorage.removeItem(TOKEN_KEY)
      sessionTrustedUntil = 0
    }
  }

  async function loadPreLogin() {
    if (preLoginLoaded.value) return
    try {
      const data = unwrap(await getRouterApi().getPreLoginConfig())
      firstBoot.value = data.firstBoot
      needAuthorized.value = data.needAuthorized
    } catch {
      firstBoot.value = 0
      needAuthorized.value = 1
    } finally {
      preLoginLoaded.value = true
    }
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
    try {
      unwrap(await getRouterApi().ping())
      /** 与首页 getSystemInfo（同 HYID 107）错开重复等待：探测成功后短暂信任 */
      markSessionEstablished()
      return true
    } catch {
      setSession(null)
      return false
    }
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
