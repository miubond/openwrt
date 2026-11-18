/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ROUTER_ADAPTER?: 'mock' | 'factory' | 'device'
  readonly VITE_API_BASE?: string
  readonly VITE_BASE_PATH?: string
  readonly VITE_DEVICE_URL?: string
  /** 开发代理目标，仅 Vite server.proxy 读取 */
  readonly VITE_DEV_PROXY_TARGET?: string
  /** 原厂华翼主业务 CGI 路径 */
  readonly VITE_HUAYI_CGI?: string
  /** 原厂模组 CGI 路径 */
  readonly VITE_MODEM_CGI?: string
  /** 开发期临时绕过登录；生产勿开启 */
  readonly VITE_AUTH_BYPASS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __API_MODE__: 'mock' | 'ubus' | undefined
