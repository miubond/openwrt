<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import UiIcon from '@/components/UiIcon.vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { findPrimaryByPath, primaryNav, showSubnav, type NavChild } from '@/nav'
import UiModal from '@/components/UiModal.vue'
import { formatApiError, getRouterApi, unwrap } from '@/api'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const theme = useThemeStore()
const mobileOpen = ref(false)
const userOpen = ref(false)
const rebootOpen = ref(false)
const rebootBusy = ref(false)
const toast = useToastStore()
const shellRef = ref<HTMLElement | null>(null)

const currentPrimary = computed(() => findPrimaryByPath(route.path))
const hasSub = computed(() => showSubnav(currentPrimary.value))
const pageTitle = computed(() => {
  const name = typeof route.name === 'string' ? route.name : ''
  if (name) {
    const key = `routes.${name}`
    const translated = t(key)
    if (translated !== key) return translated
  }
  return t(currentPrimary.value.labelKey)
})

function isPrimaryActive(key: string) {
  return currentPrimary.value.key === key
}

function isChildActive(to: string) {
  return route.path === to
}

function sectionHasActive(children: NavChild[]) {
  return children.some((c) => isChildActive(c.to))
}

async function onLogout() {
  userOpen.value = false
  await auth.logout()
  router.push({ name: 'login' })
}

async function doReboot() {
  if (rebootBusy.value) return
  rebootBusy.value = true
  rebootOpen.value = false
  try {
    unwrap(await getRouterApi().rebootDevice())
    toast.info(t('common.rebooting'))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    rebootBusy.value = false
  }
}

function closeTransientChrome() {
  mobileOpen.value = false
  userOpen.value = false
}

function onDocumentPointerDown(e: PointerEvent) {
  const shell = shellRef.value
  if (!shell) return
  const target = e.target as Node
  if (userOpen.value) {
    const userWrap = shell.querySelector('.user-wrap')
    if (userWrap && !userWrap.contains(target)) userOpen.value = false
  }
  if (mobileOpen.value) {
    const menuBtn = shell.querySelector('.menu-btn')
    const subnav = shell.querySelector('.subnav')
    if (menuBtn?.contains(target) || subnav?.contains(target)) return
    mobileOpen.value = false
  }
}

function onViewportResize() {
  if (window.innerWidth >= 960) closeTransientChrome()
}

watch(
  () => route.fullPath,
  () => closeTransientChrome(),
)

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  window.addEventListener('resize', onViewportResize)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  window.removeEventListener('resize', onViewportResize)
})
</script>

<template>
  <div ref="shellRef" class="app-shell" :class="{ 'mobile-open': mobileOpen }">
    <header class="app-header">
      <div class="layout-frame">
      <button class="menu-btn" type="button" :aria-label="t('common.menu')" @click="mobileOpen = !mobileOpen">
        ☰
      </button>

      <div class="brand">
        <div class="brand-mark">
          <UiIcon name="router" :size="18" />
        </div>
        <div class="brand-text">
          <div class="brand-title">
            <span class="brand-title-full">{{ t('brand.title') }}</span>
            <span class="brand-title-short">{{ t('brand.short') }}</span>
          </div>
          <div v-if="t('brand.sub')" class="brand-sub">{{ t('brand.sub') }}</div>
        </div>
      </div>

      <nav class="primary-nav" :aria-label="t('nav.home')">
        <RouterLink
          v-for="item in primaryNav"
          :key="item.key"
          :to="item.to"
          class="primary-item"
          :class="{ active: isPrimaryActive(item.key) }"
          :title="t(item.labelKey)"
        >
          <span class="primary-ico">
            <UiIcon :name="item.icon" :size="16" />
          </span>
          <span class="primary-label">{{ t(item.labelKey) }}</span>
        </RouterLink>
      </nav>

      <div class="header-right">
        <button
          class="icon-btn"
          type="button"
          :title="theme.isDark ? t('theme.toLight') : t('theme.toDark')"
          :aria-label="theme.isDark ? t('theme.toLight') : t('theme.toDark')"
          @click="theme.toggleTheme()"
        >
          <UiIcon :name="theme.isDark ? 'sun' : 'moon'" :size="16" />
        </button>
        <LocaleSwitcher />
        <button
          class="icon-btn"
          type="button"
          :title="t('common.rebootDevice')"
          :aria-label="t('common.rebootDevice')"
          :disabled="rebootBusy"
          @click="rebootOpen = true"
        >
          <UiIcon name="power" :size="16" />
        </button>
        <div class="user-wrap">
          <button class="user-btn" type="button" :title="t('common.admin')" @click="userOpen = !userOpen">
            <span class="user-avatar"><UiIcon name="user" :size="14" /></span>
            <span class="user-name">{{ t('common.admin') }}</span>
          </button>
          <div v-if="userOpen" class="user-menu" @click.stop>
            <button type="button" @click="onLogout">{{ t('common.logout') }}</button>
          </div>
        </div>
      </div>
      </div>
    </header>

    <!-- 移动端主菜单 -->
    <nav class="mobile-primary">
      <RouterLink
        v-for="item in primaryNav"
        :key="item.key"
        :to="item.to"
        class="mobile-primary-item"
        :class="{ active: isPrimaryActive(item.key) }"
        @click="mobileOpen = false"
      >
        <UiIcon :name="item.icon" :size="14" />
        {{ t(item.labelKey) }}
      </RouterLink>
    </nav>

    <div class="app-body layout-frame">
      <aside v-if="hasSub" class="subnav">
        <div class="subnav-head">
          <span class="subnav-head-ico">
            <UiIcon :name="currentPrimary.icon" :size="16" />
          </span>
          <span>{{ t(currentPrimary.labelKey) }}</span>
        </div>
        <nav class="subnav-list">
          <template v-if="currentPrimary.sections?.length">
            <div
              v-for="section in currentPrimary.sections"
              :key="section.labelKey"
              class="subnav-section"
              :class="{ open: sectionHasActive(section.children) }"
            >
              <div class="subnav-section-title">{{ t(section.labelKey) }}</div>
              <RouterLink
                v-for="child in section.children"
                :key="child.to"
                :to="child.to"
                class="subnav-item"
                :class="{ active: isChildActive(child.to) }"
                @click="mobileOpen = false"
              >
                <span class="subnav-ico">
                  <UiIcon :name="child.icon" :size="16" />
                </span>
                <span class="subnav-label">{{ t(child.labelKey) }}</span>
                <span v-if="child.status === 'dev'" class="tag muted">{{ t('common.statusDev') }}</span>
                <span v-else-if="child.status === 'limited'" class="tag warn">{{ t('common.statusLimited') }}</span>
              </RouterLink>
            </div>
          </template>
          <template v-else>
            <RouterLink
              v-for="child in currentPrimary.children"
              :key="child.to"
              :to="child.to"
              class="subnav-item"
              :class="{ active: isChildActive(child.to) }"
              @click="mobileOpen = false"
            >
              <span class="subnav-ico">
                <UiIcon :name="child.icon" :size="16" />
              </span>
              <span class="subnav-label">{{ t(child.labelKey) }}</span>
              <span v-if="child.status === 'dev'" class="tag muted">{{ t('common.statusDev') }}</span>
              <span v-else-if="child.status === 'limited'" class="tag warn">{{ t('common.statusLimited') }}</span>
            </RouterLink>
          </template>
        </nav>
      </aside>

      <main class="app-main" :class="{ 'is-surface': route.meta.mainSurface }">
        <h1 v-if="route.name !== 'dashboard' && !route.meta.hidePageTitle" class="page-title">{{ pageTitle }}</h1>
        <RouterView />
      </main>
    </div>

    <div v-if="mobileOpen" class="backdrop" aria-hidden="true" />

    <UiModal
      :open="rebootOpen"
      :title="t('common.rebootConfirmTitle')"
      danger
      @close="rebootOpen = false"
      @confirm="doReboot"
    >
      {{ t('common.rebootConfirmBody') }}
    </UiModal>
  </div>
</template>

<style scoped>
.app-shell {
  --header-h: 62px;
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-family-system);
}

/* ===== Header ===== */
.layout-frame {
  width: 100%;
  max-width: var(--layout-max-width);
  margin-inline: auto;
}

.app-header {
  position: relative;
  z-index: 40;
  flex-shrink: 0;
  height: calc(var(--header-h) + var(--safe-top));
  padding-top: var(--safe-top);
  color: #fff;
  background: linear-gradient(180deg, #0c2450 0%, var(--color-header) 100%);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04), 0 2px 10px rgba(7, 22, 51, 0.25);
  overflow: visible;
}

.app-header .layout-frame {
  display: flex;
  align-items: stretch;
  height: 100%;
}

.menu-btn {
  display: none;
  align-self: center;
  border: 0;
  background: transparent;
  color: #fff;
  margin-left: 8px;
  min-width: var(--touch-min);
  min-height: var(--touch-min);
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1.5rem;
  line-height: 1;
}

.brand {
  display: flex;
  align-items: center;
  align-self: center;
  gap: 10px;
  min-width: 0;
  flex-shrink: 0;
  padding: 0 16px;
  height: 100%;
}

.brand-mark {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.12);
}

.brand-text {
  min-width: 0;
  line-height: 1.2;
}

.brand-title {
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
  letter-spacing: 0.01em;
  white-space: nowrap;
  line-height: var(--lh-tight);
}

.brand-title-short {
  display: none;
}

.brand-sub {
  font-size: var(--fs-xs);
  color: rgba(255, 255, 255, 0.55);
  line-height: var(--lh-tight);
}

/* 顶栏主菜单：选中项高度铺满 header */
.primary-nav {
  display: none;
  align-items: stretch;
  justify-content: center;
  gap: 0;
  flex: 1;
  min-width: 0;
  height: 100%;
  margin-left: 0;
  overflow-x: auto;
  overflow-y: visible;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.primary-nav::-webkit-scrollbar {
  display: none;
}

.primary-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  min-height: 100%;
  padding: 0 28px;
  border-radius: 0;
  color: rgba(255, 255, 255, 0.88);
  font-size: 14px;
  font-weight: var(--fw-medium);
  line-height: 1;
  white-space: nowrap;
  flex: 0 1 auto;
  transition: background 0.15s ease, color 0.15s ease;
}

.primary-item:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.primary-item.active {
  color: #fff;
  background: #1677ff;
  font-weight: var(--fw-semibold);
  box-shadow: none;
}

.primary-ico {
  display: grid;
  place-items: center;
  color: inherit;
  opacity: 0.95;
}

.primary-item.active .primary-ico {
  opacity: 1;
}

.primary-label {
  letter-spacing: 0.01em;
}

.header-right {
  position: relative;
  z-index: 2;
  margin-left: auto;
  display: flex;
  align-items: center;
  align-self: center;
  gap: 4px;
  flex-shrink: 0;
  height: 100%;
  padding: 0 16px 0 8px;
  overflow: visible;
}

.icon-btn,
.user-btn {
  border: 0;
  background: transparent;
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 8px;
  padding: 6px 8px;
}

.icon-btn:hover:not(:disabled),
.user-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.icon-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.user-wrap {
  position: relative;
}

.user-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  display: grid;
  place-items: center;
}

.user-btn {
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  line-height: var(--lh-tight);
}

.user-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  min-width: 132px;
  background: var(--color-surface);
  color: var(--color-title);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: var(--shadow-menu);
  z-index: 80;
}

.user-menu button {
  width: 100%;
  border: 0;
  background: var(--color-surface);
  color: var(--color-title);
  text-align: left;
  padding: 10px 12px;
  cursor: pointer;
  font-size: var(--fs-base);
  line-height: var(--lh-tight);
}

.user-menu button:hover {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

/* ===== Mobile primary ===== */
.mobile-primary {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding: 8px 10px;
  padding-left: max(10px, var(--safe-left));
  padding-right: max(10px, var(--safe-right));
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  z-index: 30;
}

.mobile-primary-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  border-radius: 999px;
  min-height: 36px;
  padding: 8px 12px;
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  line-height: var(--lh-tight);
  color: var(--color-text);
  background: var(--color-bg-muted);
}

.mobile-primary-item.active {
  color: var(--color-primary);
  background: var(--color-primary-soft);
  font-weight: var(--fw-semibold);
}

/* ===== Body / Sidebar ===== */
.app-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.subnav {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  padding: 12px 10px 0;
}

.subnav-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin: 4px 6px 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-bg-soft);
  color: var(--color-title);
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}

.subnav-head-ico {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.subnav-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 0 0 16px;
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
.subnav-list:hover,
.subnav-list:focus-within {
  scrollbar-color: color-mix(in srgb, var(--color-muted) 55%, transparent) transparent;
}
.subnav-list::-webkit-scrollbar-thumb {
  background-color: transparent;
}
.subnav-list:hover::-webkit-scrollbar-thumb,
.subnav-list:focus-within::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--color-muted) 50%, transparent);
}

.subnav-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
}

.subnav-section:last-child {
  margin-bottom: 0;
}

.subnav-section-title {
  padding: 8px 12px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--color-muted);
  text-transform: none;
}

.subnav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  color: var(--color-text);
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  line-height: var(--lh-tight);
  transition: background 0.15s ease, color 0.15s ease;
}

.subnav-item:hover {
  background: var(--color-bg-soft);
  color: var(--color-title);
}

.subnav-item.active {
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: var(--fw-semibold);
}

.subnav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--color-primary);
}

.subnav-ico {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  color: var(--color-muted);
  flex-shrink: 0;
}

.subnav-item:hover .subnav-ico,
.subnav-item.active .subnav-ico {
  color: var(--color-primary);
}

.subnav-label {
  flex: 1;
  min-width: 0;
  line-height: 1.3;
}

.tag {
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  line-height: 1;
  padding: 3px 5px;
  border-radius: 4px;
  flex-shrink: 0;
}

.tag.muted {
  background: var(--color-bg-muted);
  color: var(--color-muted);
}

.tag.warn {
  background: var(--color-warning-soft);
  color: var(--color-warning);
}

.app-main {
  min-width: 0;
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 18px 20px calc(28px + var(--safe-bottom));
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
.app-main:hover,
.app-main:focus-within {
  scrollbar-color: color-mix(in srgb, var(--color-muted) 55%, transparent) transparent;
}
.app-main::-webkit-scrollbar-thumb {
  background-color: transparent;
}
.app-main:hover::-webkit-scrollbar-thumb,
.app-main:focus-within::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--color-muted) 50%, transparent);
}

.app-main.is-surface {
  padding: 0;
  background: var(--color-surface);
}

.page-title {
  margin: 0 0 8px;
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--color-title);
  line-height: var(--lh-tight);
  letter-spacing: 0.01em;
}

.backdrop {
  display: none;
}

@media (min-width: 960px) {
  .primary-nav {
    display: flex;
  }
  .mobile-primary {
    display: none;
  }
}

/* 中等宽度：压缩品牌与右侧，收紧菜单间距 */
@media (max-width: 1280px) {
  .brand-sub {
    display: none;
  }

  .brand-title-full {
    display: none;
  }

  .brand-title-short {
    display: inline;
  }

  .primary-item {
    padding: 0 10px;
    gap: 5px;
  }

  .user-name {
    display: none;
  }
}

/* 接近移动断点：仅图标菜单，悬停看 title */
@media (max-width: 980px) and (min-width: 960px) {
  .primary-nav {
    justify-content: flex-start;
  }

  .primary-item {
    width: 48px;
    min-width: 48px;
    padding: 0;
    gap: 0;
  }

  .primary-label {
    display: none;
  }
}

@media (max-width: 959px) {
  .menu-btn {
    display: inline-flex;
  }
  .brand-sub {
    display: none;
  }
  .brand-title-full {
    display: none;
  }
  .brand-title-short {
    display: inline;
  }
  .user-name {
    display: none;
  }
  .mobile-primary {
    z-index: 32;
    padding: 8px 12px;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .mobile-primary::-webkit-scrollbar {
    display: none;
  }
  .app-main {
    padding: 12px 12px max(20px, env(safe-area-inset-bottom, 0px));
  }
  .page-title {
    font-size: 1.05rem;
    margin: 0 0 10px;
    line-height: 1.35;
  }
  .subnav {
    position: fixed;
    left: 0;
    top: calc(56px + var(--safe-top));
    bottom: 0;
    width: min(280px, 86vw);
    height: auto;
    z-index: 35;
    transform: translateX(-105%);
    transition: transform 0.2s ease;
    box-shadow: 8px 0 24px rgba(15, 23, 42, 0.08);
    overflow: hidden;
    padding: 12px 10px 0;
    padding-bottom: 0;
    pointer-events: none;
  }
  .subnav-list {
    padding-bottom: calc(16px + var(--safe-bottom));
  }
  .mobile-open .subnav {
    transform: translateX(0);
    pointer-events: auto;
  }
  .mobile-open .backdrop {
    display: block;
    position: fixed;
    inset: 0;
    top: calc(56px + var(--safe-top));
    background: rgba(10, 31, 68, 0.35);
    z-index: 34;
    /* 仅作暗化，不拦截点击（否则会挡住主内容按钮，需点两次） */
    pointer-events: none;
  }
  .app-main {
    padding: 12px 12px calc(20px + var(--safe-bottom));
  }
  .page-title {
    font-size: var(--fs-md, var(--fs-base));
  }
  .icon-btn,
  .user-btn {
    min-width: var(--touch-min);
    min-height: var(--touch-min);
    justify-content: center;
  }
}
</style>
