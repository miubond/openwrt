import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

const repoRoot = fileURLToPath(new URL('.', import.meta.url))
const CDN_FONT_BLOCK =
  /<!-- mp716:cdn-fonts:start[\s\S]*?<!-- mp716:cdn-fonts:end -->\s*/u

/** 开发代理：把设备 Set-Cookie 改写到 localhost，否则登录 2000 但后续 HYID 全 4001 */
function applyDevProxyCookieRewrite(proxy: { on(event: string, handler: (...args: unknown[]) => void): void }) {
  proxy.on('proxyRes', (...args: unknown[]) => {
    const proxyRes = args[0] as { headers?: Record<string, string | string[] | undefined> }
    const raw = proxyRes.headers?.['set-cookie']
    if (!raw) return
    const list = Array.isArray(raw) ? raw : [raw]
    proxyRes.headers!['set-cookie'] = list.map((cookie) =>
      cookie
        .replace(/;\s*Domain=[^;]*/gi, '')
        .replace(/;\s*Secure/gi, '')
        .replace(/;\s*SameSite=[^;]*/gi, ''),
    )
  })
}

const devCgiProxy = (target: string) => ({
  target,
  changeOrigin: true,
  configure: applyDevProxyCookieRewrite,
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isNative = mode === 'openwrt'
  const isProd = mode === 'production' || mode === 'mp716-test' || isNative
  const apiEntry = isNative ? 'src/api/index.native.ts' : 'src/api/index.prod.ts'
  const proxyTarget = env.VITE_DEV_PROXY_TARGET || env.VITE_DEVICE_URL || 'http://10.251.0.140/'
  return {
    base: env.VITE_BASE_PATH || (isProd ? '/mp716/' : '/'),
    plugins: [
      vue(),
      tailwindcss(),
      ...(isProd
        ? [
            {
              name: 'mp716-swap-api-index',
              enforce: 'pre',
              resolveId(id: string) {
                const norm = id.replace(/\\/g, '/')
                if (norm === '@/api' || norm.endsWith('/api/index.ts') || norm.endsWith('/api')) {
                  return resolve(repoRoot, apiEntry)
                }
                return null
              },
            },
            {
              name: 'mp716-strip-cdn-fonts',
              apply: 'build',
              transformIndexHtml(html: string) {
                return html.replace(
                  CDN_FONT_BLOCK,
                  '    <!-- 生产：系统字体回退（fonts.css），避免外网 CDN 阻塞首屏 -->\n    ',
                )
              },
            },
            ...(isNative
              ? [
                  {
                    name: 'mp716-openwrt-html-cache',
                    apply: 'build' as const,
                    transformIndexHtml(html: string) {
                      if (html.includes('http-equiv="Cache-Control"')) return html
                      return html.replace(
                        '<head>',
                        '<head>\n    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />\n    <meta http-equiv="Pragma" content="no-cache" />',
                      )
                    },
                  },
                ]
              : []),
          ]
        : []),
    ],
    resolve: {
      alias: [
        { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
        ...(isProd
          ? [
              {
                find: resolve(repoRoot, 'src/api/index.ts'),
                replacement: resolve(repoRoot, apiEntry),
              },
            ]
          : []),
      ],
    },
    build: {
      outDir: isNative ? 'dist-openwrt' : 'dist',
      target: 'es2019',
      /** 单文件 CSS，减少 /www 小文件数量与 inode 占用 */
      cssCodeSplit: false,
      sourcemap: false,
      chunkSizeWarningLimit: 400,
      modulePreload: { polyfill: false },
      esbuild: isProd ? { drop: ['console', 'debugger'] } : undefined,
      rollupOptions: isProd
        ? {
            output: {
              manualChunks(id) {
                if (!id.includes('node_modules')) return undefined
                if (
                  id.includes('vue') ||
                  id.includes('pinia') ||
                  id.includes('vue-router') ||
                  id.includes('vue-i18n') ||
                  id.includes('@intlify')
                ) {
                  return 'vendor-vue'
                }
                return undefined
              },
            },
          }
        : undefined,
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    },
    server: {
      port: 5173,
      proxy: {
        // 原厂 lighttpd CGI（cgi_huayi / cgi_modem / cgi_no_login 等）
        '/cgi-bin': devCgiProxy(proxyTarget),
        // 原厂 ubus（若登录/会话走 ubus）
        '/ubus': devCgiProxy(proxyTarget),
      },
    },
  }
})
