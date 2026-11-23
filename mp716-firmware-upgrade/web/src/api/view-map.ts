import type { ConnectedDevice, InterfaceStatus, WanStatus, WifiStatus, SystemInfo, SystemStatus } from './types'

/** Dashboard / 设备列表用的宽松视图模型 */
export interface DeviceView {
  id: string
  name: string
  ip?: string
  mac: string
  link: 'ethernet' | 'wifi' | 'unknown'
  online: boolean
  signalDbm?: number
  blocked: boolean
  iface?: string
  rxBytes?: number
  txBytes?: number
}

export function toDeviceView(d: ConnectedDevice): DeviceView {
  return {
    id: d.id,
    name: d.hostname || d.mac,
    ip: d.ipv4,
    mac: d.mac,
    link: d.wired === true ? 'ethernet' : d.wired === false ? 'wifi' : 'unknown',
    online: d.online ?? false,
    blocked: d.blocked ?? false,
    iface: d.interface,
    rxBytes: d.rxBytes,
    txBytes: d.txBytes,
  }
}

export interface WanStatusView {
  up: boolean
  proto: string
  ipv4?: string
  netmask?: string
  gateway?: string
  dns: string[]
  mac?: string
  mtu?: number
  uptimeSec?: number
  rxBytes: number
  txBytes: number
  rxRateBps: number
  txRateBps: number
}

export function toWanStatusView(w: WanStatus): WanStatusView {
  return {
    up: w.connected,
    proto: w.proto,
    ipv4: w.ipv4,
    netmask: w.netmask,
    gateway: w.gateway,
    dns: w.dns || [],
    mac: w.mac,
    mtu: w.mtu,
    uptimeSec: w.uptimeSec,
    rxBytes: w.rxBytes,
    txBytes: w.txBytes,
    rxRateBps: w.rxRateBps ?? 0,
    txRateBps: w.txRateBps ?? 0,
  }
}

export interface WifiStatusView {
  up: boolean
  ssid?: string
  /** 展示用信道文案：AUTO / 6 / 6(AUTO) */
  channelLabel: string
  clients: number
  mode?: string
  security?: string
  mac?: string
}

export function toWifiStatusView(w: WifiStatus): WifiStatusView {
  const channelLabel =
    w.channel === 0
      ? 'AUTO'
      : w.autoChannel
        ? `${w.channel}(AUTO)`
        : String(w.channel)
  return {
    up: w.enabled,
    ssid: w.ssid,
    channelLabel,
    clients: w.clients,
    mode: w.mode,
    security: w.security || undefined,
    mac: w.mac,
  }
}

export interface SystemStatusView {
  hostname: string
  domain?: string
  deviceNumber?: string
  model: string
  boardName: string
  firmwareVersion: string
  openwrtRelease: string
  kernel: string
  uptimeSec: number
  load: [number, number, number]
  memory: { total: number; free: number; buffered: number; cached: number }
  memoryPercent: number
  flash: { total: number; free: number }
  cpu?: { usagePercent?: number }
  time: { local: string; timezone: string }
  interfaces: InterfaceStatus[]
}

export function toSystemStatusView(info: SystemInfo, status: SystemStatus): SystemStatusView {
  return {
    hostname: info.hostname,
    domain: info.domain,
    deviceNumber: info.deviceNumber,
    model: info.model,
    boardName: info.model,
    firmwareVersion: info.firmware,
    openwrtRelease: info.kernel ? info.firmware : '',
    kernel: info.kernel,
    uptimeSec: status.uptimeSec || info.uptimeSec,
    load: [info.cpuLoad[0] || 0, info.cpuLoad[1] || 0, info.cpuLoad[2] || 0],
    memory: {
      total: info.memTotalKb * 1024,
      free: info.memFreeKb * 1024,
      buffered: 0,
      cached: 0,
    },
    memoryPercent: status.memoryPercent,
    flash: {
      total: info.flashTotalKb * 1024,
      free: info.flashFreeKb * 1024,
    },
    cpu: { usagePercent: status.cpuSampled === false ? undefined : status.cpuPercent ?? undefined },
    time: { local: info.localTime, timezone: info.timezone || 'Asia/Shanghai' },
    interfaces: status.interfaces || [],
  }
}
