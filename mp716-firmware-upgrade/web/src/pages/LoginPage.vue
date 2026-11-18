<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import UiButton from '@/components/UiButton.vue'
import UiField from '@/components/UiField.vue'
import UiIcon from '@/components/UiIcon.vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { getApiMode, getRouterApi, unwrap } from '@/api'

const { t } = useI18n()
const auth = useAuthStore()
const theme = useThemeStore()
const router = useRouter()
const route = useRoute()
const username = ref('admin')
const password = ref('')
const showPassword = ref(false)
/** 通过 WAN IP 打开登录页时，局域网用户应改连 LAN 地址（NAT 回流常导致 CGI 登录失败） */
const lanLoginHref = ref<string | null>(null)

function loginBasePath(): string {
  const base = import.meta.env.BASE_URL || '/'
  return base.endsWith('/') ? base.slice(0, -1) : base
}

onMounted(async () => {
  if (route.query.expired === '1') {
    auth.error = t('common.sessionExpired')
  }
  if (auth.authenticated) {
    const ok = await auth.refreshSession()
    if (!ok) auth.setSession(null)
  }
  if (getApiMode() !== 'factory') return
  const loadWanHint = async () => {
    try {
      const api = getRouterApi()
      const [w, l] = await Promise.all([api.getWanStatus(), api.getLanStatus()])
      const wanIp = unwrap(w).ipv4?.trim()
      const lanIp = unwrap(l).ipv4?.trim()
      const host = window.location.hostname
      if (wanIp && lanIp && host === wanIp && lanIp !== host) {
        lanLoginHref.value = `http://${lanIp}${loginBasePath()}/#/login`
      }
    } catch {
      /* 无法探测时不在此猜测 LAN 地址 */
    }
  }
  const schedule =
    typeof requestIdleCallback === 'function'
      ? (cb: () => void) => requestIdleCallback(cb, { timeout: 2500 })
      : (cb: () => void) => window.setTimeout(cb, 0)
  schedule(() => void loadWanHint())
})

watch(
  () => auth.preLoginLoaded,
  (loaded) => {
    if (loaded && auth.wizardWithoutLogin()) void router.replace({ name: 'wizard' })
  },
)

async function onSubmit() {
  try {
    await auth.login(username.value, password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    if (!redirect && auth.wizardAfterLogin()) {
      await router.replace({ name: 'wizard' })
      return
    }
    await router.replace(redirect || '/')
  } catch {
    /* store */
  }
}
</script>

<template>
  <div class="login">
    <div class="login-toolbar">
      <button
        class="login-theme"
        type="button"
        :title="theme.isDark ? t('theme.toLight') : t('theme.toDark')"
        :aria-label="theme.isDark ? t('theme.toLight') : t('theme.toDark')"
        @click="theme.toggleTheme()"
      >
        <UiIcon :name="theme.isDark ? 'sun' : 'moon'" :size="16" />
      </button>
      <LocaleSwitcher variant="login" />
    </div>
    <div class="login-stage" aria-hidden="true">
      <div class="login-glow login-glow--a" />
      <div class="login-glow login-glow--b" />
      <svg class="login-mesh" viewBox="0 0 960 720" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="meshStroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#7eb6ff" stop-opacity="0.55" />
            <stop offset="100%" stop-color="#1677ff" stop-opacity="0.12" />
          </linearGradient>
        </defs>
        <g class="login-mesh-lines" fill="none" stroke="url(#meshStroke)" stroke-width="1.2">
          <path d="M40 120 L220 80 L380 160 L560 90 L740 150 L920 70" />
          <path d="M60 280 L240 220 L420 300 L600 210 L780 290 L940 230" />
          <path d="M30 460 L210 390 L390 470 L580 380 L760 450 L930 390" />
          <path d="M80 620 L260 540 L440 610 L620 520 L800 600 L920 540" />
          <path d="M220 80 L240 220 L210 390 L260 540" />
          <path d="M380 160 L420 300 L390 470 L440 610" />
          <path d="M560 90 L600 210 L580 380 L620 520" />
          <path d="M740 150 L780 290 L760 450 L800 600" />
        </g>
        <g class="login-mesh-nodes" fill="#9cc8ff">
          <circle cx="220" cy="80" r="3.5" />
          <circle cx="380" cy="160" r="3" />
          <circle cx="560" cy="90" r="4" />
          <circle cx="240" cy="220" r="3" />
          <circle cx="420" cy="300" r="4.5" />
          <circle cx="600" cy="210" r="3" />
          <circle cx="210" cy="390" r="3.5" />
          <circle cx="580" cy="380" r="3" />
          <circle cx="760" cy="450" r="4" />
          <circle cx="440" cy="610" r="3" />
          <circle cx="620" cy="520" r="3.5" />
        </g>
      </svg>
      <div class="login-signal" />
    </div>

    <div class="login-shell">
      <header class="login-brand">
        <div class="login-mark">
          <UiIcon name="router" :size="28" />
        </div>
        <h1 class="login-title">{{ t('brand.short') }}</h1>
        <p class="login-lead">{{ t('login.lead') }}</p>
        <p class="login-sub">{{ t('login.sub') }}</p>
      </header>

      <form class="login-form" @submit.prevent="onSubmit">
        <h2 class="login-form-title">{{ t('login.formTitle') }}</h2>
        <div v-if="lanLoginHref" class="login-wan-hint" role="status">
          <p>{{ t('login.wanAccessHint') }}</p>
          <a :href="lanLoginHref" class="login-wan-link">{{ t('login.lanLoginLink') }}</a>
        </div>
        <UiField :label="t('login.username')" for-id="user">
          <input id="user" v-model="username" autocomplete="username" required placeholder="admin" />
        </UiField>
        <UiField :label="t('login.password')" for-id="pass" :error="auth.error">
          <div class="login-pass">
            <input
              id="pass"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              required
              :placeholder="t('login.passwordPh')"
            />
            <button
              class="login-pass-toggle"
              type="button"
              :aria-pressed="showPassword"
              :aria-label="showPassword ? t('login.hidePassword') : t('login.showPassword')"
              @click="showPassword = !showPassword"
            >
              <UiIcon :name="showPassword ? 'eyeOff' : 'eye'" :size="16" />
            </button>
          </div>
        </UiField>
        <UiButton type="submit" block :disabled="auth.loading">
          {{ auth.loading ? t('login.submitting') : t('login.submit') }}
        </UiButton>
        <p v-if="getApiMode() === 'mock'" class="login-hint">{{ t('login.mockHint') }}</p>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login {
  position: relative;
  isolation: isolate;
  min-height: 100vh;
  min-height: 100dvh;
  padding:
    max(12px, var(--safe-top))
    max(12px, var(--safe-right))
    max(16px, var(--safe-bottom))
    max(12px, var(--safe-left));
  overflow: hidden;
  color: #fff;
  background:
    radial-gradient(120% 80% at 12% 18%, rgba(22, 119, 255, 0.28), transparent 55%),
    radial-gradient(90% 70% at 88% 82%, rgba(8, 47, 110, 0.55), transparent 50%),
    linear-gradient(155deg, #041028 0%, #0b1f44 48%, #12306a 100%);
  font-family: var(--font-family-system);
}

.login-toolbar {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.login-theme {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
  backdrop-filter: blur(8px);
}

.login-theme:hover {
  background: rgba(255, 255, 255, 0.22);
}

.login-stage {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.login-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(40px);
  opacity: 0.55;
  animation: glow-drift 14s ease-in-out infinite alternate;
}

.login-glow--a {
  top: -8%;
  left: -6%;
  width: min(48vw, 420px);
  height: min(48vw, 420px);
  background: rgba(22, 119, 255, 0.35);
}

.login-glow--b {
  right: -10%;
  bottom: -12%;
  width: min(56vw, 520px);
  height: min(56vw, 520px);
  background: rgba(60, 140, 255, 0.22);
  animation-delay: -4s;
  animation-duration: 18s;
}

.login-mesh {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0.55;
  animation: mesh-drift 22s linear infinite;
}

.login-mesh-nodes circle {
  transform-origin: center;
  animation: node-pulse 3.6s ease-in-out infinite;
}

.login-mesh-nodes circle:nth-child(2n) {
  animation-delay: 0.6s;
}

.login-mesh-nodes circle:nth-child(3n) {
  animation-delay: 1.2s;
}

.login-signal {
  position: absolute;
  left: 8%;
  top: 58%;
  width: min(42vw, 360px);
  height: min(42vw, 360px);
  border: 1px solid rgba(158, 200, 255, 0.18);
  border-radius: 50%;
  transform: translateY(-50%);
  animation: signal-expand 5.5s ease-out infinite;
}

.login-signal::before,
.login-signal::after {
  content: '';
  position: absolute;
  inset: 18%;
  border: 1px solid rgba(158, 200, 255, 0.14);
  border-radius: 50%;
}

.login-signal::after {
  inset: 36%;
  border-color: rgba(158, 200, 255, 0.1);
}

.login-shell {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: clamp(28px, 5vw, 72px);
  align-items: center;
  min-height: 100vh;
  min-height: 100dvh;
  width: min(1120px, calc(100% - 48px));
  margin: 0 auto;
  padding: clamp(28px, 5vh, 64px) 0;
}

.login-brand {
  max-width: 520px;
  animation: brand-in 0.8s ease-out both;
}

.login-mark {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: 20px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  backdrop-filter: blur(8px);
}

.login-title {
  margin: 0;
  font-size: clamp(48px, 8vw, 84px);
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 0.95;
  color: #fff;
}

.login-lead {
  margin: 18px 0 0;
  font-size: clamp(18px, 2.4vw, 24px);
  font-weight: 600;
  line-height: 1.3;
  color: rgba(255, 255, 255, 0.92);
}

.login-sub {
  margin: 10px 0 0;
  max-width: 28ch;
  font-size: 15px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.62);
}

.login-form {
  width: 100%;
  max-width: 400px;
  justify-self: end;
  padding: 28px 28px 24px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 16px;
  background: color-mix(in srgb, var(--color-surface) 96%, transparent);
  color: var(--color-title);
  box-shadow: 0 18px 48px rgba(4, 16, 40, 0.22);
  animation: form-in 0.75s cubic-bezier(0.22, 1, 0.36, 1) 0.12s both;
}

:global(html.dark) .login-form {
  border-color: rgba(255, 255, 255, 0.14);
  background: color-mix(in srgb, var(--color-surface) 92%, transparent);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
}

.login-form-title {
  margin: 0 0 18px;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--color-title);
}

.login-pass {
  position: relative;
}

.login-pass :deep(input) {
  padding-right: 40px;
}

.login-pass-toggle {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  padding: 0;
}

.login-pass-toggle:hover {
  color: var(--color-primary);
}

.login-wan-hint {
  margin: 0 0 16px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-warning, #fa8c16) 12%, var(--color-surface));
  border: 1px solid color-mix(in srgb, var(--color-warning, #fa8c16) 35%, transparent);
}

.login-wan-hint p {
  margin: 0 0 8px;
}

.login-wan-link {
  font-weight: 600;
  color: var(--color-primary);
  text-decoration: none;
}

.login-wan-link:hover {
  text-decoration: underline;
}

.login-hint {
  margin: 14px 0 0;
  text-align: center;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-muted);
}

@keyframes brand-in {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes form-in {
  from {
    opacity: 0;
    transform: translateY(28px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes mesh-drift {
  from {
    transform: translate3d(0, 0, 0) scale(1.02);
  }
  to {
    transform: translate3d(-2.5%, 1.5%, 0) scale(1.06);
  }
}

@keyframes glow-drift {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(4%, 6%, 0);
  }
}

@keyframes node-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}

@keyframes signal-expand {
  0% {
    opacity: 0.45;
    transform: translateY(-50%) scale(0.86);
  }
  70% {
    opacity: 0;
  }
  100% {
    opacity: 0;
    transform: translateY(-50%) scale(1.28);
  }
}

@media (max-width: 900px) {
  .login-toolbar {
    top: max(12px, var(--safe-top));
    right: max(12px, var(--safe-right));
  }

  .login-shell {
    grid-template-columns: 1fr;
    align-content: center;
    width: min(440px, 100%);
    gap: 28px;
    padding: 24px 0;
  }

  .login-brand {
    text-align: center;
    max-width: none;
  }

  .login-mark {
    margin-left: auto;
    margin-right: auto;
  }

  .login-sub {
    margin-left: auto;
    margin-right: auto;
  }

  .login-form {
    justify-self: stretch;
    max-width: none;
  }

  .login-signal {
    display: none;
  }
}

@media (max-width: 480px) {
  .login-title {
    font-size: 1.35rem;
  }

  .login-form {
    padding: 20px 16px;
    border-radius: 12px;
  }

  .login-theme,
  .login-toolbar :deep(button) {
    min-width: var(--touch-min);
    min-height: var(--touch-min);
  }
}

@media (prefers-reduced-motion: reduce) {
  .login-brand,
  .login-form,
  .login-glow,
  .login-mesh,
  .login-mesh-nodes circle,
  .login-signal {
    animation: none !important;
  }
}
</style>
