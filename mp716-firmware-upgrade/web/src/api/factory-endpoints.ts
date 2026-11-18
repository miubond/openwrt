/**
 * 原厂 CGI 入口（相对站点根路径）。
 * 开发时由 Vite 代理到 VITE_DEV_PROXY_TARGET；生产由设备 lighttpd 直接提供。
 */
export const HUAYI_CGI =
  (import.meta.env.VITE_HUAYI_CGI as string | undefined) || '/cgi-bin/cgi_huayi.cgi'

export const MODEM_CGI =
  (import.meta.env.VITE_MODEM_CGI as string | undefined) || '/cgi-bin/cgi_modem.cgi'

export const STREAM_CGI =
  (import.meta.env.VITE_STREAM_CGI as string | undefined) || '/cgi-bin/cgi_stream.cgi'
