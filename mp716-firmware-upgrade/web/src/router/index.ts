import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/LoginPage.vue'),
      meta: { public: true, title: '登录' },
    },
    {
      path: '/wizard',
      name: 'wizard',
      component: () => import('@/pages/WizardPage.vue'),
      meta: {
        public: true,
        title: '快速设置向导',
        cgi: 'cgi_huayi.cgi',
        readActions: ['get_quick_setting_config'],
        writeActions: ['set_quick_setting_config', 'set_first_boot'],
      },
    },
    {
      path: '/',
      component: () => import('@/layouts/AppLayout.vue'),
      children: [
        {
          path: '',
          name: 'dashboard',
          component: () => import('@/pages/DashboardPage.vue'),
          meta: { title: '首页', hidePageTitle: true },
        },

        // 网络
        { path: 'network/wan', name: 'network-wan', component: () => import('@/pages/WanPage.vue'), meta: { title: '广域网设置' } },
        {
          path: 'network/wan-status',
          name: 'network-wan-status',
          component: () => import('@/pages/network/WanStatusPage.vue'),
          meta: { title: '广域网状态', hidePageTitle: true, mainSurface: true },
        },
        { path: 'network/lan', name: 'network-lan', component: () => import('@/pages/network/LanOnlyPage.vue'), meta: { title: '局域网设置' } },
        {
          path: 'network/lan-status',
          name: 'network-lan-status',
          component: () => import('@/pages/network/LanStatusPage.vue'),
          meta: { title: '局域网状态', hidePageTitle: true, mainSurface: true },
        },
        { path: 'network/dhcp', name: 'network-dhcp', component: () => import('@/pages/network/DhcpPage.vue'), meta: { title: 'DHCP设置' } },

        // 无线
        { path: 'wifi/basic', name: 'wifi-basic', component: () => import('@/pages/wifi/WifiBasicPage.vue'), meta: { title: '基础设置' } },
        {
          path: 'wifi/advanced',
          name: 'wifi-advanced',
          component: () => import('@/pages/wifi/WifiAdvancedPage.vue'),
          meta: { title: '高级设置' },
        },
        { path: 'wifi/acl', name: 'wifi-acl', component: () => import('@/pages/wifi/WifiMacPage.vue'), meta: { title: '无线ACL' } },

        // 终端（单页）
        { path: 'devices', name: 'devices', component: () => import('@/pages/DevicesPage.vue'), meta: { title: '终端管理' } },

        // VPN
        {
          path: 'advanced/vpn/pptpd',
          name: 'vpn-pptpd',
          component: () => import('@/pages/advanced/VpnServerPage.vue'),
          props: { kind: 'pptp' },
          meta: { title: 'PPTP服务器' },
        },
        {
          path: 'advanced/vpn/xl2tpd',
          name: 'vpn-xl2tpd',
          component: () => import('@/pages/advanced/VpnServerPage.vue'),
          props: { kind: 'l2tp' },
          meta: { title: 'L2TP服务器' },
        },
        {
          path: 'advanced/vpn/pptp',
          name: 'vpn-pptp',
          component: () => import('@/pages/advanced/PptpClientPage.vue'),
          meta: { title: 'PPTP客户端' },
        },
        {
          path: 'advanced/vpn/xl2tp',
          name: 'vpn-xl2tp',
          component: () => import('@/pages/advanced/L2tpClientPage.vue'),
          meta: { title: 'L2TP客户端' },
        },
        {
          path: 'advanced/vpn/users',
          name: 'vpn-users',
          component: () => import('@/pages/advanced/VpnUsersPage.vue'),
          meta: { title: '用户管理' },
        },
        {
          path: 'advanced/vpn/status',
          name: 'vpn-status',
          component: () => import('@/pages/advanced/VpnStatusPage.vue'),
          meta: { title: '用户状态' },
        },
        {
          path: 'advanced/vpn/openvpn',
          name: 'vpn-openvpn',
          component: () => import('@/pages/advanced/OpenVpnPage.vue'),
          meta: { title: 'OpenVPN客户端' },
        },

        // 系统（挂在高级下）
        {
          path: 'advanced/system/device',
          name: 'sys-device',
          component: () => import('@/pages/system/InfoPage.vue'),
          meta: { title: '设备信息' },
        },
        {
          path: 'advanced/system/upgrade',
          name: 'sys-upgrade',
          component: import.meta.env.VITE_ROUTER_ADAPTER === 'device' ? () => import('@/pages/system/UpgradeNativePage.vue') : () => import('@/pages/system/UpgradePage.vue'),
          meta: { title: '固件升级' },
        },
        {
          path: 'advanced/system/reset',
          name: 'sys-reset',
          component: () => import('@/pages/system/ResetOnlyPage.vue'),
          meta: { title: '恢复出厂设置' },
        },
        {
          path: 'advanced/system/config',
          name: 'sys-config',
          component: import.meta.env.VITE_ROUTER_ADAPTER === 'device' ? () => import('@/pages/system/BackupNativePage.vue') : () => import('@/pages/system/BackupPage.vue'),
          meta: { title: '系统配置' },
        },
        {
          path: 'advanced/system/reboot',
          name: 'sys-reboot',
          component: () => import('@/pages/system/RebootOnlyPage.vue'),
          meta: { title: '重启' },
        },
        {
          path: 'advanced/system/sche-reboot',
          name: 'sys-sche-reboot',
          component: () => import('@/pages/system/ScheRebootPage.vue'),
          meta: { title: '定时重启' },
        },
        {
          path: 'advanced/system/time',
          name: 'sys-time',
          component: () => import('@/pages/system/TimePage.vue'),
          meta: { title: 'NTP设置' },
        },
        {
          path: 'advanced/system/log',
          name: 'sys-log',
          component: import.meta.env.VITE_ROUTER_ADAPTER === 'device' ? () => import('@/pages/LogsNativePage.vue') : () => import('@/pages/LogsPage.vue'),
          meta: { title: '系统日志' },
        },
        {
          path: 'advanced/system/admin',
          name: 'sys-admin',
          component: () => import('@/pages/system/PasswordPage.vue'),
          meta: { title: '管理员设置' },
        },

        // 工具
        {
          path: 'advanced/tool/ping',
          name: 'tool-ping',
          component: () => import('@/pages/advanced/ToolDetectPage.vue'),
          meta: { title: 'Ping检测', tool: 'ping' },
        },
        {
          path: 'advanced/tool/tracert',
          name: 'tool-tracert',
          component: () => import('@/pages/advanced/ToolDetectPage.vue'),
          meta: { title: '路由跟踪', tool: 'tracert' },
        },
        {
          path: 'advanced/tool/dhcp-test',
          name: 'tool-dhcp-test',
          component: () => import('@/pages/advanced/ToolDetectPage.vue'),
          meta: { title: 'DHCP检测', tool: 'dhcp-test' },
        },

        // —— 旧路径兼容 / 范围外入口收拢 ——
        { path: 'network/dns', redirect: '/network/wan' },
        { path: 'network/qos', redirect: '/network/wan' },
        { path: 'wifi/mac', redirect: '/wifi/acl' },
        { path: 'wifi/clients', redirect: '/devices' },
        { path: 'devices/online', redirect: '/devices' },
        { path: 'devices/access', redirect: '/devices' },
        { path: 'devices/ratelimit', redirect: '/devices' },
        { path: 'advanced/firewall', redirect: '/advanced/vpn/pptpd' },
        { path: 'advanced/port-forward', redirect: '/advanced/vpn/pptpd' },
        { path: 'advanced/diagnose', redirect: '/advanced/tool/ping' },
        { path: 'advanced/qos', redirect: '/network/wan' },
        { path: 'advanced/dmz', redirect: '/advanced/vpn/pptpd' },
        { path: 'advanced/static-route', redirect: '/advanced/vpn/pptpd' },
        { path: 'advanced/ddns', redirect: '/advanced/vpn/pptpd' },
        { path: 'advanced/upnp', redirect: '/advanced/vpn/pptpd' },
        { path: 'advanced/vpn', redirect: '/advanced/vpn/pptpd' },
        { path: 'advanced', redirect: '/advanced/vpn/pptpd' },
        { path: 'system/info', redirect: '/advanced/system/device' },
        { path: 'system/password', redirect: '/advanced/system/admin' },
        { path: 'system/time', redirect: '/advanced/system/time' },
        { path: 'system/logs', redirect: '/advanced/system/log' },
        { path: 'system/backup', redirect: '/advanced/system/config' },
        { path: 'system/upgrade', redirect: '/advanced/system/upgrade' },
        { path: 'system/reboot', redirect: '/advanced/system/reboot' },
        { path: 'system', redirect: '/advanced/system/device' },
        { path: 'wan', redirect: '/network/wan' },
        { path: 'lan', redirect: '/network/lan' },
        { path: 'wifi', redirect: '/wifi/basic' },
        { path: 'qos', redirect: '/network/wan' },
        { path: 'firewall', redirect: '/advanced/vpn/pptpd' },
        { path: 'logs', redirect: '/advanced/system/log' },
      ],
    },
  ],
})

const authBypass =
  import.meta.env.DEV && import.meta.env.VITE_AUTH_BYPASS === '1'

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  if (!authBypass && !auth.preLoginLoaded) {
    const preLogin = auth.loadPreLogin()
    const fastPublic = to.meta.public && (to.name === 'login' || to.name === 'wizard')
    if (fastPublic) void preLogin
    else await preLogin
  }

  // 开发期临时去掉登录限制，便于对齐菜单与页面（契约接通后设 VITE_AUTH_BYPASS=0）
  if (authBypass) {
    if (!auth.authenticated) auth.setSession('factory-dev-bypass')
    if (to.name === 'login') return { name: 'dashboard' }
    return true
  }

  if (to.meta.public) {
    if (to.name === 'login' && auth.wizardWithoutLogin()) return { name: 'wizard' }
    // 不根据 localStorage 自动踢走登录页，便于重新登录 / 换账号
    return true
  }
  if (!auth.authenticated) {
    if (auth.wizardWithoutLogin()) return { name: 'wizard' }
    const ok = await auth.refreshSession()
    if (!ok) return { name: 'login', query: { redirect: to.fullPath, expired: '1' } }
  } else if (!auth.isSessionTrusted()) {
    const ok = await auth.refreshSession()
    if (!ok) return { name: 'login', query: { redirect: to.fullPath, expired: '1' } }
  }
  return true
})

export default router
