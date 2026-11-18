import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FactoryCgiAdapter } from '@/api/adapters/factory-cgi-adapter'
import { FACTORY_CGI_CONTRACT, HUAYI_HYID, MODEM_HYID } from '@/api/factory-contract'
import { md5Hex } from '@/api/factory/md5'
import type { RouterAPI } from '@/api/router-api'

const repoRoot = resolve(__dirname, '../..')
const RESTORE_PROBE = 2 * 1024 * 1024 + 1

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'text/plain' },
  })
}

describe('factory CGI adapter', () => {
  it('posts the captured login body and keeps the username unchanged', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ errcode: 2000, huayierrtype: 'success' }),
    )
    const api = new FactoryCgiAdapter()
    const res = await api.login({ username: 'admin', password: 'secret' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.token).toBe('huayi-session')

    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('/cgi-bin/cgi_huayi.cgi')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      hy_username: 'admin',
      hy_userpwd: md5Hex('secret'),
      HYID: HUAYI_HYID.doLoginAuth,
    })
    expect(JSON.stringify(init?.body)).not.toMatch(/root/)
    fetchSpy.mockRestore()
  })

  it('does not rewrite a non-admin username', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ errcode: 4006 }))
    const api = new FactoryCgiAdapter()
    const res = await api.login({ username: 'operator', password: 'secret' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toBe('密码不正确')
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as { hy_username: string }
    expect(body.hy_username).toBe('operator')
    fetchSpy.mockRestore()
  })

  it('hashes passwords the way the factory bundle does', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(md5Hex('secret')).toBe('5ebe2294ecd0e0f08eab7690d2a6ee69')
  })

  it('reads pre-login config for wizard routing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getPreLoginConfig) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: { first_boot: 1, need_authorized: 0, company_name: 'MP716', sysmode: 1 },
        })
      }
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const pre = await api.getPreLoginConfig()
    expect(pre.ok && pre.data).toEqual({
      firstBoot: 1,
      needAuthorized: 0,
      companyName: 'MP716',
      sysMode: 1,
    })
    fetchSpy.mockRestore()
  })

  it('reads and writes quick setting wizard payloads', async () => {
    const calls: Array<Record<string, unknown>> = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      calls.push(body)
      if (body.HYID === HUAYI_HYID.getQuickSettingConfig) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: {
            first_boot: 1,
            wan_type: 'wired',
            proto: 'dhcp',
            host_name: 'MP716',
            ssid_config: { ssid_2g: 'MP716', encry_2g: 1, passphrase_2g: '12345678' },
          },
        })
      }
      if (body.HYID === HUAYI_HYID.setQuickSettingConfig) {
        return jsonResponse({ errcode: 2000, progresstime: 5, reconnection: 0, reconnection_addr: '' })
      }
      if (body.HYID === HUAYI_HYID.setFirstBoot) {
        return jsonResponse({ errcode: 2000 })
      }
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const read = await api.getQuickSetting()
    expect(read.ok && read.data?.firstBoot).toBe(1)
    const saved = await api.applyQuickSetting(
      { wanType: 'wired', proto: 'dhcp', hostName: 'gw', dns: [] },
      { ssid2g: 'MP716', encry2g: 1, passphrase2g: '12345678' },
    )
    expect(saved.ok && saved.data?.progressSec).toBe(5)
    const done = await api.completeWizardFirstBoot()
    expect(done.ok).toBe(true)
    expect(calls.find((c) => c.HYID === HUAYI_HYID.setQuickSettingConfig)).toMatchObject({
      HYID: 10,
      wan_type: 'wired',
      proto: 'dhcp',
      host_name: 'gw',
      ssid_2g: 'MP716',
      encry_2g: 1,
    })
    fetchSpy.mockRestore()
  })

  it('reads device information from get_system_info', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getDeviceInfo) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: {
            product_name: 'MP716',
            product_model: 'MP716',
            software_version: '014',
            webui_version: 'WEB014',
            lan_mac: '00:1C:A3:36:43:51',
            ip_address: '10.251.0.135',
          },
        })
      }
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const read = await api.getDeviceInfo()
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data).toEqual({
      productName: 'MP716',
      productModel: 'MP716',
      softwareVersion: '014',
      webuiVersion: 'WEB014',
      lanMac: '00:1C:A3:36:43:51',
      wanIp: '10.251.0.135',
    })
    fetchSpy.mockRestore()
  })

  it('maps the recorded home-page CGI payloads', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getHomeSystemInfo) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: {
            pro_name: 'MP716',
            fw_version: '1.2.3',
            domain: 'step.YunXM.net',
            device_umber: '001CA3364353',
            time_day: '2026-11-12 12:00',
            uptime: 3661,
          },
        })
      }
      if (body.HYID === HUAYI_HYID.getNetworkInfo) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: {
            wan_infos: {
              link: 1,
              mac_addr: '00:1C:A3:36:43:56',
              mtu_num: 1500,
              ip_addr: '1.2.3.4',
              subnet_mask: '255.255.255.0',
              gateway: '1.2.3.1',
              dns_server_addr_addr: ['8.8.8.8', '8.8.4.4'],
              net_type: 'Wired',
              tx_bps: 2048,
              rx_bps: 4096,
            },
            lan_infos: {
              mac_addr: '00:1C:A3:36:43:57',
              ip_addr: '192.168.1.1',
              subnet_mask: '255.255.255.0',
              client_sum: 3,
            },
          },
        })
      }
      if (body.HYID === HUAYI_HYID.getHomeNetworkInfo) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: {
            port_arr: [
              { port: 'LAN1', link: 0, speed: 100 },
              { port: 'LAN2', link: 0, speed: 0 },
              { port: 'LAN3', link: 1, speed: 100 },
              { port: 'LAN4', link: 0, speed: 0 },
              { port: 'WAN', link: 1, speed: 100 },
            ],
            wireless_arr: [{
              status: 1,
              ssid: 'mp716',
              channel: 0,
              auto_channel: 0,
              band: 9,
              client_sum: 2,
              auth_mode: 'WPA2PSK',
              bssid: '00:1C:A3:36:43:53',
            }],
          },
        })
      }
      if (body.HYID === HUAYI_HYID.getAllStaList) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: { staline_arr: [{ ip_addr: '192.168.1.2', mac_addr: 'aa:bb:cc:dd:ee:ff', host_name: 'phone' }] },
        })
      }
      return jsonResponse({ errcode: 4004 })
    })

    const api = new FactoryCgiAdapter()
    const info = await api.getSystemInfo()
    const wan = await api.getWanStatus()
    const wifi = await api.getWifiStatus()
    const ports = await api.getPhysicalPorts()
    const lan = await api.getLanStatus()
    const devices = await api.getConnectedDevices()

    expect(info.ok && info.data).toMatchObject({
      model: 'MP716',
      firmware: '1.2.3',
      hostname: '',
      domain: 'step.YunXM.net',
      deviceNumber: '001CA3364353',
      uptimeSec: 3661,
      localTime: '2026-11-12 12:00',
    })
    expect(wan.ok && wan.data).toMatchObject({
      connected: true,
      proto: 'Wired',
      ipv4: '1.2.3.4',
      netmask: '255.255.255.0',
      gateway: '1.2.3.1',
      dns: ['8.8.8.8', '8.8.4.4'],
      mtu: 1500,
      txRateBps: 2048,
      rxRateBps: 4096,
    })
    expect(wifi.ok && wifi.data).toMatchObject({
      enabled: true,
      ssid: 'mp716',
      channel: 0,
      autoChannel: false,
      mode: '11BGN',
      security: 'WPA2PSK',
      mac: '00:1C:A3:36:43:53',
      clients: 2,
    })
    expect(ports.ok && ports.data).toHaveLength(5)
    expect(ports.ok && ports.data?.find((p) => p.label === 'WAN')?.linkUp).toBe(true)
    expect(lan.ok && lan.data).toMatchObject({
      ipv4: '192.168.1.1',
      netmask: '255.255.255.0',
      clientCount: 3,
    })
    expect(lan.ok && lan.data.dhcpEnabled).toBeUndefined()
    expect(devices.ok && devices.data).toEqual([
      {
        id: 'aa:bb:cc:dd:ee:ff',
        mac: 'aa:bb:cc:dd:ee:ff',
        ipv4: '192.168.1.2',
        hostname: 'phone',
        interface: '',
        online: true,
        rxBytes: 0,
        txBytes: 0,
        lastSeen: '',
      },
    ])
    expect(fetchSpy.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).HYID)).toEqual([
      HUAYI_HYID.getHomeSystemInfo,
      HUAYI_HYID.getNetworkInfo,
      HUAYI_HYID.getHomeNetworkInfo,
      HUAYI_HYID.getAllStaList,
    ])
    fetchSpy.mockRestore()
  })

  it('reads and updates device ACL via HYID 60–62', async () => {
    const calls: Array<{ HYID: number; acl_addr?: string }> = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number; acl_addr?: string }
      calls.push(body)
      if (body.HYID === HUAYI_HYID.getAclList) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: { acl_arr: [{ acl_addr: '11:22:33:44:55:66' }] },
        })
      }
      if (body.HYID === HUAYI_HYID.addAclList || body.HYID === HUAYI_HYID.deleteAclList) {
        return jsonResponse({ errcode: 2000 })
      }
      return jsonResponse({ errcode: 4004 })
    })

    const api = new FactoryCgiAdapter()
    const list = await api.getDeviceAclList()
    expect(list.ok && list.data).toEqual([{ mac: '11:22:33:44:55:66' }])

    const added = await api.addDeviceAcl('aa:bb:cc:dd:ee:ff')
    expect(added.ok).toBe(true)

    const removed = await api.removeDeviceAcl('11:22:33:44:55:66')
    expect(removed.ok).toBe(true)

    expect(calls).toEqual([
      { HYID: HUAYI_HYID.getAclList },
      { HYID: HUAYI_HYID.addAclList, acl_addr: 'aa:bb:cc:dd:ee:ff' },
      { HYID: HUAYI_HYID.deleteAclList, acl_addr: '11:22:33:44:55:66' },
    ])
    fetchSpy.mockRestore()
  })

  it('reads LAN and DHCP from the recorded CGI and writes the pool back intact', async () => {
    const calls: Array<{ HYID: number; body: Record<string, unknown> }> = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number } & Record<string, unknown>
      calls.push({ HYID: body.HYID, body })
      if (body.HYID === HUAYI_HYID.getLanConfig) {
        return jsonResponse({ errcode: 2000, huayi_r: { ip_addr: '192.168.199.1', subnet_mask: '255.255.255.0' } })
      }
      if (body.HYID === HUAYI_HYID.getDhcpsServerConfig) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: {
            dhcp_enable: true,
            min_ip: '192.168.199.1',
            max_ip: '192.168.199.254',
            start_ip: '192.168.199.1',
            end_ip: '192.168.199.254',
            lease_time: 7200,
            static_dhcp_arr: [{ ip_addr: '192.168.199.20', mac_addr: 'AA:BB:CC:DD:EE:FF', name: 'cam' }],
          },
        })
      }
      if (body.HYID === HUAYI_HYID.setDhcpsServerConfig) {
        return jsonResponse({ errcode: 2000, huayierrtype: 'success' })
      }
      return jsonResponse({ errcode: 4004 })
    })

    const api = new FactoryCgiAdapter()
    const lan = await api.getLanConfig()
    const dhcp = await api.getDhcpConfig()
    expect(lan.ok && lan.data).toEqual({ ipv4: '192.168.199.1', netmask: '255.255.255.0' })
    expect(dhcp.ok && dhcp.data).toMatchObject({
      enabled: true,
      startIp: '192.168.199.1',
      endIp: '192.168.199.254',
      limit: 254,
      leasetime: '7200',
      leases: [],
      staticBindings: [{ ipv4: '192.168.199.20', mac: 'AA:BB:CC:DD:EE:FF', hostname: 'cam' }],
    })

    const saved = await api.updateDhcpConfig({
      enabled: true,
      start: 100,
      limit: 50,
      leasetime: '2h',
      gateway: '192.168.199.1',
      dns: [],
      leases: [],
      startIp: '192.168.199.100',
    })
    expect(saved.ok).toBe(true)
    const write = calls.find((call) => call.HYID === HUAYI_HYID.setDhcpsServerConfig)
    expect(write?.body).toMatchObject({
      HYID: 27,
      dhcp_enable: true,
      start_ip: '192.168.199.100',
      end_ip: '192.168.199.149',
      lease_time: 7200,
      static_dhcp_arr: [{ ip_addr: '192.168.199.20', mac_addr: 'AA:BB:CC:DD:EE:FF', name: 'cam' }],
    })
    fetchSpy.mockRestore()
  })

  it('reads 2.4G advanced settings and a disabled ACL list', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getWirelessBasicConfig) {
        return jsonResponse({ errcode: 2000, huayi_r: { wifi_admin: 1 } })
      }
      if (body.HYID === HUAYI_HYID.getWirelessAdvCfg) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: {
            bgprotect_mode: 0,
            beacon: 100,
            dtim: 1,
            rts_thres: 2347,
            frag_thres: 2346,
            tx_burst: 1,
            tx_preamble: 1,
            wmm: 1,
          },
        })
      }
      if (body.HYID === HUAYI_HYID.getWirelessAclCfg) {
        return jsonResponse({ errcode: 2000, huayi_r: { wifi_admin: 0, macfilter_arr: [] } })
      }
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const adv = await api.getWifiAdvanced()
    const acl = await api.getWirelessAcl()
    expect(adv.ok && adv.data).toMatchObject({ radioOn: true, beacon: 100, txPreamble: 1, wmm: 1 })
    expect(acl.ok && acl.data).toEqual({ mode: 'disable', entries: [] })
    const ids = fetchSpy.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).HYID)
    expect(ids).toContain(HUAYI_HYID.getWirelessAdvCfg)
    expect(ids).toContain(HUAYI_HYID.getWirelessAclCfg)
    fetchSpy.mockRestore()
  })

  it('reads a disabled PPTP client and keeps the original body when saving it off', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getPptpClientConfig) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: {
            pptp_enable: false,
            pptp_status: 0,
            pptp_addr: '0.0.0.0',
            server_addr: '',
            usr: '',
            pwd: '',
            mppe: 0,
            route_type: 0,
            pptp_static_arr: [],
            extra_flag: 1,
          },
        })
      }
      if (body.HYID === HUAYI_HYID.setPptpClientConfig) {
        return jsonResponse({ errcode: 2000, huayierrtype: 'success', progresstime: 0 })
      }
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const read = await api.getPptpClient()
    expect(read.ok && read.data).toMatchObject({
      enabled: false,
      status: 0,
      address: '0.0.0.0',
      server: '',
      routes: [],
    })
    const saved = await api.updatePptpClient({
      enabled: false,
      status: 1,
      address: '10.0.0.8',
      server: 'should-not-be-written.example',
      username: 'user',
      password: 'abc123',
      mppe: 2,
      routeType: 1,
      routes: [{ target: '10.8.0.0', netmask: '255.255.255.0' }],
    })
    expect(saved.ok && saved.data).toMatchObject({ accepted: true, rollbackSec: 0 })
    const write = JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body)) as Record<string, unknown>
    expect(write).toMatchObject({
      HYID: HUAYI_HYID.setPptpClientConfig,
      pptp_enable: false,
      server_addr: '',
      extra_flag: 1,
    })
    expect(write.usr).toBe('')
    expect(write.pwd).toBe('')
    fetchSpy.mockRestore()
  })

  it('saves an enabled PPTP client with plaintext credentials and static routes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getPptpClientConfig) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: {
            pptp_enable: true,
            pptp_status: 1,
            pptp_addr: '10.8.0.8',
            server_addr: 'old.example',
            usr: 'old',
            pwd: 'old-pass',
            mppe: 0,
            route_type: 1,
            pptp_static_arr: [],
          },
        })
      }
      if (body.HYID === HUAYI_HYID.setPptpClientConfig) {
        return jsonResponse({ errcode: 2000 })
      }
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const saved = await api.updatePptpClient({
      enabled: true,
      status: 0,
      address: '',
      server: 'vpn.example',
      username: 'vpnuser',
      password: 'abc123',
      mppe: 1,
      routeType: 0,
      routes: [{ target: '192.168.8.0', netmask: '255.255.255.0' }],
    })
    expect(saved.ok).toBe(true)
    const write = JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body)) as Record<string, unknown>
    expect(write).toMatchObject({
      HYID: HUAYI_HYID.setPptpClientConfig,
      pptp_enable: true,
      pptp_status: 1,
      pptp_addr: '10.8.0.8',
      server_addr: 'vpn.example',
      usr: 'vpnuser',
      pwd: 'abc123',
      mppe: 1,
      route_type: 0,
      pptp_static_arr: [{ target: '192.168.8.0', subnet_mask: '255.255.255.0' }],
    })
    expect(write.pwd).not.toBe(md5Hex('abc123'))
    fetchSpy.mockRestore()
  })

  it('reads upgrade info and refuses a file larger than the device limit', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getUpgradeInfo) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: {
            pro_model: 'MP716',
            fw_version: '014',
            release_time: '2024-11-13 11:16:54',
            maxsize: 100,
            maxsize_tip: '8M',
            module_version: '',
          },
        })
      }
      return jsonResponse({ errcode: 4004 }, String(url).includes('cgi_stream') ? 500 : 200)
    })
    const api = new FactoryCgiAdapter()
    const info = await api.getFirmwareInfo()
    expect(info.ok && info.data).toMatchObject({
      hardware: 'MP716',
      currentVersion: '014',
      buildDate: '2024-11-13 11:16:54',
      maxBytes: 100,
      maxSizeLabel: '8M',
    })
    const tooBig = await api.uploadFirmware(new Blob([new Uint8Array(101)]))
    expect(tooBig.ok).toBe(false)
    if (!tooBig.ok) expect(tooBig.message).toBe('文件不能大于8M!')
    expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes('cgi_stream'))).toBe(false)
    fetchSpy.mockRestore()
  })

  it('posts the firmware file to stream 4 and keeps settings unless asked not to', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('cgi_stream')) {
        return jsonResponse({ errcode: 2000, huayierrtype: 'success' })
      }
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getUpgradeInfo) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: { pro_model: 'MP716', fw_version: '014', release_time: '2024-11-13 11:16:54', maxsize: 8060928, maxsize_tip: '8M' },
        })
      }
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const file = new Blob(['firmware'])
    const kept = await api.uploadFirmware(file)
    expect(kept.ok && kept.data).toMatchObject({ accepted: true, rollbackSec: 0 })
    const keptCall = fetchSpy.mock.calls.find((call) => String(call[0]).includes('cgi_stream'))
    expect(String(keptCall?.[0])).toBe('/cgi-bin/cgi_stream.cgi?streamid=4&keep_setting=1')
    expect(keptCall?.[1]?.body).toBeInstanceOf(FormData)
    expect((keptCall?.[1]?.body as FormData).get('userfile')).toBeTruthy()
    expect(keptCall?.[1]?.headers).toBeUndefined()

    const wiped = await api.uploadFirmware(file, { keepSettings: false })
    expect(wiped.ok).toBe(true)
    const wipedCall = fetchSpy.mock.calls.filter((call) => String(call[0]).includes('cgi_stream')).at(-1)
    expect(String(wipedCall?.[0])).toBe('/cgi-bin/cgi_stream.cgi?streamid=4&keep_setting=0')
    fetchSpy.mockRestore()
  })

  it('reads a disabled schedule and NTP settings', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getScheRebootConfig) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: {
            sche_mode: 0,
            rectime: 1800,
            hour: 0,
            minute: 0,
            weeks: 0,
            time_day: 1794458272,
            remaining: 0,
          },
        })
      }
      if (body.HYID === HUAYI_HYID.getNtpConfig) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: {
            ntp_admin: true,
            time_zone: 'CST-8',
            ntp_server_arr: ['cn.ntp.org.cn', 'hk.ntp.org.cn', 'us.ntp.org.cn'],
            time_day: 1794458272,
          },
        })
      }
      if (body.HYID === HUAYI_HYID.setScheRebootConfig || body.HYID === HUAYI_HYID.setNtpConfig) {
        return jsonResponse({ errcode: 2000 })
      }
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const sche = await api.getScheReboot()
    expect(sche.ok && sche.data).toMatchObject({
      mode: 0,
      remainHour: 0,
      remainMinute: 30,
      weeks: 0,
      remainingSec: 0,
    })
    const ntp = await api.getSystemTime()
    expect(ntp.ok && ntp.data).toMatchObject({
      timezone: 'CST-8',
      ntpEnabled: true,
      ntpServers: ['cn.ntp.org.cn', 'hk.ntp.org.cn', 'us.ntp.org.cn'],
    })
    if (ntp.ok) expect(ntp.data.localTime).toMatch(/^2026-11-12 /)

    const saved = await api.updateScheReboot({
      mode: 0,
      remainHour: 1,
      remainMinute: 0,
      hour: 3,
      minute: 0,
      weeks: 255,
      timeDay: 1,
      remainingSec: 9,
    })
    expect(saved.ok).toBe(true)
    const write = JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body)) as Record<string, unknown>
    expect(write).toEqual({ HYID: HUAYI_HYID.setScheRebootConfig, sche_mode: 0 })

    const tooSoon = await api.updateScheReboot({
      mode: 1,
      remainHour: 0,
      remainMinute: 9,
      hour: 0,
      minute: 0,
      weeks: 0,
      timeDay: 0,
      remainingSec: 0,
    })
    expect(tooSoon.ok).toBe(false)
    if (!tooSoon.ok) expect(tooSoon.message).toBe('不能少于10分钟!')
    fetchSpy.mockRestore()
  })

  it('keeps the original NTP servers when synchronization is turned off', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID?: number }
      if (body.HYID === HUAYI_HYID.getNtpConfig) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: {
            ntp_admin: true,
            time_zone: 'CST-8',
            ntp_server_arr: ['cn.ntp.org.cn', 'hk.ntp.org.cn', 'us.ntp.org.cn'],
            time_day: 1794458272,
          },
        })
      }
      if (body.HYID === HUAYI_HYID.setNtpConfig) return jsonResponse({ errcode: 2000 })
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const saved = await api.updateSystemTime({
      timezone: 'CST-8',
      ntpEnabled: false,
      ntpServers: ['changed.example', '', ''],
      localTime: '',
    })
    expect(saved.ok).toBe(true)
    const write = JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body)) as Record<string, unknown>
    expect(write).toEqual({
      HYID: HUAYI_HYID.setNtpConfig,
      ntp_admin: false,
      time_zone: 'CST-8',
      ntp_server_arr: ['cn.ntp.org.cn', 'hk.ntp.org.cn', 'us.ntp.org.cn'],
    })
    fetchSpy.mockRestore()
  })

  it('reads the syslog switch and the raw log text', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number; syslog_admin?: boolean }
      if (body.HYID === HUAYI_HYID.getSyslogConfig) {
        return jsonResponse({ errcode: 2000, huayi_r: { syslog_admin: true } })
      }
      if (body.HYID === HUAYI_HYID.displaySyslog) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: { log_content: 'Thu Nov 12 11:56:35 2026 daemon.warn dnsmasq[1]: sample\n' },
        })
      }
      if (body.HYID === HUAYI_HYID.setSyslogConfig) return jsonResponse({ errcode: 2000 })
      if (body.HYID === HUAYI_HYID.cleanSyslog) return jsonResponse({ errcode: 2000 })
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const log = await api.getSystemLogs()
    expect(log.ok && log.data).toEqual({
      enabled: true,
      content: 'Thu Nov 12 11:56:35 2026 daemon.warn dnsmasq[1]: sample\n',
    })
    const saved = await api.updateSyslog(false)
    expect(saved.ok).toBe(true)
    const write = JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body)) as Record<string, unknown>
    expect(write).toEqual({ HYID: HUAYI_HYID.setSyslogConfig, syslog_admin: false })
    const cleared = await api.clearSyslog()
    expect(cleared.ok).toBe(true)
    const clearBody = JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body)) as Record<string, unknown>
    expect(clearBody).toEqual({ HYID: HUAYI_HYID.cleanSyslog })
    fetchSpy.mockRestore()
  })

  it('reads wired DHCP from the modem CGI and posts only that branch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (String(url).includes('cgi_modem') && body.HYID === MODEM_HYID.getWanConfig) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: {
            wan_mode: 'wired',
            proto: 'dhcp',
            hostname: 'ROUTE',
            mac_addr: '00:1c:a3:36:43:56',
            def_mac_addr: '00:1c:a3:36:43:56',
            cc_mtu: 1500,
            ppp_mtu: 1492,
            ip_addr: ' ',
            subnet_mask: ' ',
            gateway: ' ',
            dns_usb_arr: [''],
            usr: '',
            pwd: '',
          },
        })
      }
      if (body.HYID === HUAYI_HYID.getCurrentUserInfo) {
        return jsonResponse({ errcode: 2000, huayi_r: { usr_mac: 'aa:bb:cc:dd:ee:10' } })
      }
      if (body.HYID === MODEM_HYID.setEthWanConfig) return jsonResponse({ errcode: 2000 })
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const read = await api.getWanConfig()
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.data).toMatchObject({
        proto: 'dhcp',
        hostname: 'ROUTE',
        macaddr: '00:1c:a3:36:43:56',
        defaultMac: '00:1c:a3:36:43:56',
        clientMac: 'aa:bb:cc:dd:ee:10',
        mtu: 1500,
        pppMtu: 1492,
        ipv4: '',
        gateway: '',
        dns: [],
        wanMode: 'wired',
      })
      const unchanged = await api.updateWanConfig({ ...read.data, macaddr: '00:1C:A3:36:43:56' })
      expect(unchanged.ok).toBe(true)
      expect(fetchSpy.mock.calls.some((call) => JSON.parse(String(call[1]?.body)).HYID === MODEM_HYID.setEthWanConfig)).toBe(false)
      const saved = await api.updateWanConfig({ ...read.data, hostname: 'HOME' })
      expect(saved.ok).toBe(true)
    }
    const write = JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body)) as Record<string, unknown>
    expect(String(fetchSpy.mock.calls.at(-1)?.[0])).toBe('/cgi-bin/cgi_modem.cgi')
    expect(write).toEqual({
      HYID: MODEM_HYID.setEthWanConfig,
      wan_mode: 'wired',
      proto: 'dhcp',
      cc_mtu: 1500,
      hostname: 'HOME',
      mac_addr: '00:1C:A3:36:43:56',
    })
    fetchSpy.mockRestore()
  })

  it('reads 2.4G basic settings and posts the auth-mode payload', async () => {
    const current = {
      wifi_admin: 1,
      ssid: 'MP716-4353',
      hwmode: 9,
      band: 1,
      band_steering: 0,
      channel: 6,
      tx_power: 100,
      hidden: 0,
      noforward: 0,
      max_num: 32,
      auth_mode: 'WPAPSKWPA2PSK',
      cipher_mode: 'AES',
      encryp: 1,
      key: 'password1',
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getWirelessBasicConfig) return jsonResponse({ errcode: 2000, huayi_r: current })
      if (body.HYID === HUAYI_HYID.setWirelessBasicConfig) return jsonResponse({ errcode: 2000 })
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const read = await api.getWifiConfig()
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data).toMatchObject({
      enabled: true,
      ssid: 'MP716-4353',
      channel: 6,
      mode: '11bgn',
      htmode: 'AUTO',
      security: 'wpa-wpa2-psk',
      cipher: 'aes',
      txpowerPercent: 100,
      maxClients: 32,
      password: 'password1',
    })
    expect(fetchSpy.mock.calls[0]?.[1] && JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toMatchObject({
      HYID: HUAYI_HYID.getWirelessBasicConfig,
      wifi_radio: 0,
    })
    const same = await api.updateWifiConfig(read.data)
    expect(same.ok).toBe(true)
    expect(fetchSpy.mock.calls.some((call) => JSON.parse(String(call[1]?.body)).HYID === HUAYI_HYID.setWirelessBasicConfig)).toBe(false)
    const saved = await api.updateWifiConfig({ ...read.data, ssid: 'MP716-2G' })
    expect(saved.ok).toBe(true)
    const write = JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body)) as Record<string, unknown>
    expect(write).toEqual({
      HYID: HUAYI_HYID.setWirelessBasicConfig,
      wifi_radio: 0,
      wifi_admin: 1,
      noforward: 0,
      band_steering: 0,
      hwmode: 9,
      band: 1,
      channel: 6,
      hidden: 0,
      tx_power: 100,
      ssid: 'MP716-2G',
      max_num: 32,
      auth_mode: 'WPAPSKWPA2PSK',
      cipher_mode: 'AES',
      key: 'password1',
    })
    fetchSpy.mockRestore()
  })

  it('writes LAN, reboot, and factory reset with the recorded bodies', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getLanConfig) {
        return jsonResponse({ errcode: 2000, huayi_r: { ip_addr: '192.168.199.1', subnet_mask: '255.255.255.0', extra: 1 } })
      }
      return jsonResponse({ errcode: 2000 })
    })
    const api = new FactoryCgiAdapter()
    const lan = await api.updateLanConfig({ ipv4: '192.168.199.2', netmask: '255.255.255.0' })
    expect(lan.ok).toBe(true)
    expect(JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body))).toEqual({
      HYID: HUAYI_HYID.setLanConfig,
      ip_addr: '192.168.199.2',
      subnet_mask: '255.255.255.0',
      extra: 1,
    })
    const reboot = await api.rebootDevice()
    expect(reboot.ok).toBe(true)
    expect(JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body))).toEqual({ HYID: HUAYI_HYID.restart })
    const reset = await api.factoryReset({ confirmToken: 'RESET' })
    expect(reset.ok).toBe(true)
    expect(JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body))).toEqual({ HYID: HUAYI_HYID.reset })
    fetchSpy.mockRestore()
  })

  it('hashes both admin passwords only when the device asks for the old one', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getPasswdState) return jsonResponse({ errcode: 2000, huayi_r: { randomname: 1595 } })
      if (body.HYID === HUAYI_HYID.changeAdminPassword) return jsonResponse({ errcode: 2000 })
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const changed = await api.changeAdminPassword({ oldPassword: 'old-pass', newPassword: 'new-pass' })
    expect(changed.ok).toBe(true)
    expect(JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body))).toEqual({
      HYID: HUAYI_HYID.changeAdminPassword,
      hy_prepwd: md5Hex('old-pass'),
      hy_newpwd: md5Hex('new-pass'),
    })
    fetchSpy.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getPasswdState) return jsonResponse({ errcode: 2000, huayi_r: { randomname: 100 } })
      return jsonResponse({ errcode: 2000 })
    })
    const next = await api.changeAdminPassword({ oldPassword: 'old-pass', newPassword: 'new-pass' })
    expect(next.ok).toBe(true)
    expect(JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body))).toEqual({
      HYID: HUAYI_HYID.changeAdminPassword,
      hy_newpwd: md5Hex('new-pass'),
    })
    fetchSpy.mockRestore()
  })

  it('reads an empty VPN user table and posts the whole list', async () => {
    const current = {
      vpnusr_arr: [],
      vpn_type_arr: [
        { authenticate: 'all', index: 1 },
        { authenticate: 'pptp', index: 2 },
        { authenticate: 'l2tp', index: 3 },
      ],
      pptpd_start_addr: '172.1.1.10',
      pptpd_end_addr: '172.1.1.20',
      xl2tpd_start_addr: '172.1.1.30',
      xl2tpd_end_addr: '172.1.1.40',
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getVpnUserConfig) return jsonResponse({ errcode: 2000, huayi_r: current })
      if (body.HYID === HUAYI_HYID.setVpnUserConfig) return jsonResponse({ errcode: 2000 })
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const read = await api.getVpnUsers()
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data.users).toEqual([])
    expect(read.data.types).toEqual(['all', 'pptp', 'l2tp'])
    const outside = await api.updateVpnUsers({
      ...read.data,
      users: [{ type: 'pptp', username: 'alice', password: 'user-pass', address: '10.0.0.8', comment: '', routes: '' }],
    })
    expect(outside.ok).toBe(false)
    if (!outside.ok) expect(outside.message).toBe('分配 IP 必须在起始和结束地址之间')
    const saved = await api.updateVpnUsers({
      ...read.data,
      users: [
        {
          type: 'pptp',
          username: 'alice',
          password: 'user-pass',
          address: '172.1.1.12',
          comment: 'office',
          routes: '192.168.7.0/24',
        },
      ],
    })
    expect(saved.ok).toBe(true)
    expect(JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body))).toEqual({
      HYID: HUAYI_HYID.setVpnUserConfig,
      vpnusr_arr: [
        {
          route_arr: [{ target: '192.168.7.0', subnet_mask: '255.255.255.0' }],
          authenticate: 'pptp',
          usr: 'alice',
          pwd: 'user-pass',
          remote_addr: '172.1.1.12',
          com: 'office',
        },
      ],
    })
    fetchSpy.mockRestore()
  })

  it('reads the L2TP client and posts only the factory save shape', async () => {
    const current: Record<string, unknown> = {
      route_type: 0,
      xl2tp_enable: false,
      xl2tp_ip: '���',
      xl2tp_static_arr: [{ subnet_mask: '', target: '' }],
      xl2tp_status: 0,
      xl2tpd_enable: false,
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getL2tpClientConfig) return jsonResponse({ errcode: 2000, huayi_r: current })
      if (body.HYID === HUAYI_HYID.setL2tpClientConfig) return jsonResponse({ errcode: 2000 })
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const read = await api.getL2tpClient()
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data.address).toBe('')
    expect(read.data.enabled).toBe(false)
    const skipped = await api.updateL2tpClient(read.data)
    expect(skipped.ok).toBe(true)
    expect(fetchSpy.mock.calls.filter((call) => String(call[1]?.body).includes('"HYID":164'))).toHaveLength(0)
    current.xl2tpd_enable = true
    const blocked = await api.updateL2tpClient({
      ...read.data,
      enabled: true,
      server: 'vpn.example.com',
      username: 'alice',
      password: 'user-pass',
      ipsecKey: 'shared-key',
    })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.message).toBe('L2TP 当前工作在服务器模式，客户端暂不可用')
    current.xl2tpd_enable = false
    const saved = await api.updateL2tpClient({
      ...read.data,
      enabled: true,
      server: 'vpn.example.com',
      username: 'alice',
      password: 'user-pass',
      ipsecKey: 'shared-key',
    })
    expect(saved.ok).toBe(true)
    const posted = JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body)) as Record<string, unknown>
    expect(posted.HYID).toBe(HUAYI_HYID.setL2tpClientConfig)
    expect(posted.xl2tp_enable).toBe(true)
    expect(posted.server_addr).toBe('vpn.example.com')
    expect(posted.usr).toBe('alice')
    expect(posted.ipsec_key).toBe('shared-key')
    expect(posted.route_type).toBe(0)
    current.xl2tp_enable = true
    const disabled = await api.updateL2tpClient({ ...read.data, enabled: false })
    expect(disabled.ok).toBe(true)
    expect(JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body))).toEqual({
      HYID: HUAYI_HYID.setL2tpClientConfig,
      xl2tp_enable: false,
    })
    fetchSpy.mockRestore()
  })

  it('lists online VPN users and disconnects by pid', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getVpnUserOnline) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: {
            usr_arr: [
              {
                account: 'alice',
                account_type: 'pptp',
                ip_addr: '10.0.0.2',
                device_addr: '172.1.1.12',
                jointime: 1700000000,
                pid: 88,
              },
            ],
          },
        })
      }
      if (body.HYID === HUAYI_HYID.setVpnUserOnline) return jsonResponse({ errcode: 2000 })
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const read = await api.getVpnStatus()
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data[0]?.username).toBe('alice')
    expect(read.data[0]?.pid).toBe('88')
    expect(read.data[0]?.joinedAt.startsWith('2023-')).toBe(true)
    const gone = await api.disconnectVpnUser('88')
    expect(gone.ok).toBe(true)
    expect(JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body))).toEqual({
      HYID: HUAYI_HYID.setVpnUserOnline,
      pid: 88,
    })
    fetchSpy.mockRestore()
  })

  it('saves OpenVPN in the factory shapes and uploads userfile', async () => {
    const current = { enable: 0, host_name: '', option: 0, port: 0, pwd: '', status: 2, usr: '' }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('cgi_stream')) return jsonResponse({ errcode: 2000 })
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getOpenVpnConfig) return jsonResponse({ errcode: 2000, huayi_r: current })
      if (body.HYID === HUAYI_HYID.setOpenVpnConfig) return jsonResponse({ errcode: 2000 })
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const read = await api.getOpenVpn()
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data.status).toBe(2)
    const skipped = await api.updateOpenVpn(read.data)
    expect(skipped.ok).toBe(true)
    expect(fetchSpy.mock.calls.filter((call) => String(call[1]?.body).includes('"HYID":192'))).toHaveLength(0)
    const missing = await api.updateOpenVpn({ ...read.data, enabled: true, mode: 1, configUploaded: false })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.message).toBe('请先上传配置文件')
    const fileMode = await api.updateOpenVpn({ ...read.data, enabled: true, mode: 1, configUploaded: true })
    expect(fileMode.ok).toBe(true)
    expect(JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body))).toEqual({
      HYID: HUAYI_HYID.setOpenVpnConfig,
      enable: 1,
      option: 1,
    })
    const form = await api.updateOpenVpn({
      ...read.data,
      enabled: true,
      mode: 0,
      host: 'ovpn.example.com',
      username: 'alice',
      password: 'user-pass',
      port: 1194,
    })
    expect(form.ok).toBe(true)
    const posted = JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body)) as Record<string, unknown>
    expect(posted).toMatchObject({
      HYID: HUAYI_HYID.setOpenVpnConfig,
      enable: 1,
      option: 0,
      host_name: 'ovpn.example.com',
      usr: 'alice',
      port: 1194,
    })
    const tooBig = await api.uploadOpenVpn(new File([new Uint8Array(1024 * 1024 + 1)], 'big.ovpn'), 'config')
    expect(tooBig.ok).toBe(false)
    if (!tooBig.ok) expect(tooBig.message).toBe('文件不能大于1M!')
    const before = fetchSpy.mock.calls.length
    const config = await api.uploadOpenVpn(new File(['client'], 'client.ovpn'), 'config')
    expect(config.ok).toBe(true)
    expect(String(fetchSpy.mock.calls.at(-1)?.[0])).toBe('/cgi-bin/cgi_stream.cgi?streamid=7')
    expect(fetchSpy.mock.calls.at(-1)?.[1]?.body).toBeInstanceOf(FormData)
    const cert = await api.uploadOpenVpn(new File(['cert'], 'ca.crt'), 'cert')
    expect(cert.ok).toBe(true)
    expect(String(fetchSpy.mock.calls.at(-1)?.[0])).toBe('/cgi-bin/cgi_stream.cgi?streamid=8&name=ca.crt')
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(before)
    fetchSpy.mockRestore()
  })

  it('reads a disabled PPTP server and does not post when it stays off', async () => {
    const current = {
      pptpd_enable: false,
      pptpd_start_addr: '172.1.1.10',
      pptpd_end_addr: '172.1.1.20',
      server_addr: '192.168.7.1',
      mppe: 0,
      dns_enable: false,
      primary_dns: '',
      secondary_dns: '',
      mtu: 1482,
      mru: 1482,
      xl2tpd_start_addr: '172.1.1.30',
      xl2tpd_end_addr: '172.1.1.40',
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getPptpServerConfig) return jsonResponse({ errcode: 2000, huayi_r: current })
      if (body.HYID === HUAYI_HYID.setPptpServerConfig) return jsonResponse({ errcode: 2000 })
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const read = await api.getPptpServer()
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data).toMatchObject({ enabled: false, startIp: '172.1.1.10', endIp: '172.1.1.20', server: '192.168.7.1', mtu: 1482 })
    const kept = await api.updatePptpServer(read.data)
    expect(kept.ok).toBe(true)
    expect(fetchSpy.mock.calls.some((call) => JSON.parse(String(call[1]?.body)).HYID === HUAYI_HYID.setPptpServerConfig)).toBe(false)
    const conflict = await api.updatePptpServer({
      ...read.data,
      enabled: true,
      startIp: '172.1.1.30',
      endIp: '172.1.1.35',
    })
    expect(conflict.ok).toBe(false)
    if (!conflict.ok) expect(conflict.message).toBe('地址池与 L2TP 冲突')
    fetchSpy.mockRestore()
  })

  it('rejects an oversized restore and polls ping until the device finishes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('cgi_stream')) return jsonResponse({ errcode: 2000 })
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.doPingDetect) return jsonResponse({ errcode: 2000 })
      if (body.HYID === HUAYI_HYID.getPingDetectResult) {
        return jsonResponse({ errcode: 2000, huayi_r: { ping_detct: 2, action_content: 'ping ok' } })
      }
      return jsonResponse({ errcode: 4004 })
    })
    const api = new FactoryCgiAdapter()
    const tooBig = await api.restoreConfig(new Blob([new Uint8Array(RESTORE_PROBE)]))
    expect(tooBig.ok).toBe(false)
    if (!tooBig.ok) expect(tooBig.message).toBe('文件不能大于2M!')
    expect(fetchSpy).not.toHaveBeenCalled()
    const ping = await api.runDiagnostic({ type: 'ping', target: '192.168.199.1', count: 4 })
    expect(ping.ok && ping.data.output).toBe('ping ok')
    const start = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(start).toEqual({
      HYID: HUAYI_HYID.doPingDetect,
      dest_host_addr: '192.168.199.1',
      start_host_addr: '',
      ping_num: 4,
    })
    expect(JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body))).toEqual({ HYID: HUAYI_HYID.getPingDetectResult })
    const file = new Blob(['cfg'])
    const restored = await api.restoreConfig(file)
    expect(restored.ok).toBe(true)
    const upload = fetchSpy.mock.calls.find((call) => String(call[0]).includes('cgi_stream'))
    expect(String(upload?.[0])).toBe('/cgi-bin/cgi_stream.cgi?streamid=3')
    expect(upload?.[1]?.body).toBeInstanceOf(FormData)
    fetchSpy.mockRestore()
  })

  it('starts, polls and stops detection with the factory fields', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { HYID: number }
      if (body.HYID === HUAYI_HYID.getPingDetectResult) {
        return jsonResponse({ errcode: 2000, huayi_r: { ping_detct: 1, action_content: 'PING 1.1.1.1' } })
      }
      if (body.HYID === HUAYI_HYID.getDhcpDetectResult) {
        return jsonResponse({
          errcode: 2000,
          huayi_r: { ping_detct: 2, action_arr: [{ ip_addr: '192.168.1.1', mac_addr: 'aa:bb:cc:dd:ee:ff' }] },
        })
      }
      return jsonResponse({ errcode: 2000 })
    })
    const api = new FactoryCgiAdapter()
    const started = await api.startDiagnostic({
      type: 'ping',
      target: '1.1.1.1',
      source: '192.168.1.1',
      count: 4,
    })
    expect(started.ok).toBe(true)
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
      HYID: HUAYI_HYID.doPingDetect,
      dest_host_addr: '1.1.1.1',
      start_host_addr: '192.168.1.1',
      ping_num: 4,
    })
    const polled = await api.pollDiagnostic('ping')
    expect(polled.ok && polled.data).toMatchObject({ running: true, output: 'PING 1.1.1.1', flag: 1 })
    const stopped = await api.stopDiagnostic('ping')
    expect(stopped.ok).toBe(true)
    expect(JSON.parse(String(fetchSpy.mock.calls[2]?.[1]?.body))).toEqual({ HYID: HUAYI_HYID.stopPingDetect })

    const traced = await api.startDiagnostic({ type: 'traceroute', target: 'baidu.com', maxHops: 10, timeoutSec: 5 })
    expect(traced.ok).toBe(true)
    expect(JSON.parse(String(fetchSpy.mock.calls[3]?.[1]?.body))).toEqual({
      HYID: HUAYI_HYID.doTracertDetect,
      dest_host_addr: 'baidu.com',
      max_hops: 10,
      timeout: 5,
    })
    const dhcp = await api.pollDiagnostic('dhcp')
    expect(dhcp.ok && dhcp.data.servers).toEqual([{ ip: '192.168.1.1', mac: 'aa:bb:cc:dd:ee:ff' }])
    expect(dhcp.ok && dhcp.data.running).toBe(false)
    const invalid = await api.startDiagnostic({ type: 'ping', target: '', source: '192.168.1.1', count: 4 })
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.message).toBe('IP地址或域名不能为空!')
    const stoppedDhcp = await api.stopDiagnostic('dhcp')
    expect(stoppedDhcp.ok).toBe(true)
    expect(JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body))).toEqual({ HYID: HUAYI_HYID.stopDhcpDetect })
    fetchSpy.mockRestore()
  })

  it('lists every RouterAPI method as uncaptured except recorded login and logout', () => {
    const sample = new FactoryCgiAdapter()
    const methods: (keyof RouterAPI)[] = [
      'getPreLoginConfig',
      'login',
      'logout',
      'getQuickSetting',
      'applyQuickSetting',
      'completeWizardFirstBoot',
      'ping',
      'getSystemInfo',
      'getDeviceInfo',
      'getSystemStatus',
      'getWanStatus',
      'getWanConfig',
      'updateWanConfig',
      'getLanStatus',
      'getLanConfig',
      'updateLanConfig',
      'getDhcpConfig',
      'updateDhcpConfig',
      'updateDhcpStaticBindings',
      'getDnsConfig',
      'updateDnsConfig',
      'getWifiStatus',
      'getWifiConfig',
      'updateWifiConfig',
      'getWifiAdvanced',
      'updateWifiAdvanced',
      'getPptpClient',
      'updatePptpClient',
      'getPptpServer',
      'updatePptpServer',
      'getL2tpServer',
      'updateL2tpServer',
      'getVpnUsers',
      'updateVpnUsers',
      'getL2tpClient',
      'updateL2tpClient',
      'getVpnStatus',
      'disconnectVpnUser',
      'getOpenVpn',
      'updateOpenVpn',
      'uploadOpenVpn',
      'getWirelessClients',
      'getWirelessAcl',
      'updateWirelessAcl',
      'getConnectedDevices',
      'getDeviceAclList',
      'addDeviceAcl',
      'removeDeviceAcl',
      'disconnectDevice',
      'getFirewallRules',
      'updateFirewallRules',
      'getPortForwards',
      'updatePortForwards',
      'getQosCapability',
      'getQosConfig',
      'updateQosConfig',
      'runDiagnostic',
      'startDiagnostic',
      'pollDiagnostic',
      'stopDiagnostic',
      'getSystemLogs',
      'updateSyslog',
      'clearSyslog',
      'changeAdminPassword',
      'getSystemTime',
      'updateSystemTime',
      'getScheReboot',
      'updateScheReboot',
      'getFirmwareInfo',
      'uploadFirmware',
      'restoreConfig',
      'backupConfig',
      'downloadBackup',
      'getConfigTaskStatus',
      'confirmConfigTask',
      'rebootDevice',
      'factoryReset',
    ]
    const capturedMethods = new Set([
      'getPreLoginConfig',
      'login',
      'logout',
      'getQuickSetting',
      'applyQuickSetting',
      'completeWizardFirstBoot',
      'getSystemInfo',
      'getDeviceInfo',
      'getSystemStatus',
      'getWanStatus',
      'getWanConfig',
      'updateWanConfig',
      'getLanStatus',
      'getLanConfig',
      'updateLanConfig',
      'getDhcpConfig',
      'updateDhcpConfig',
      'updateDhcpStaticBindings',
      'getWifiStatus',
      'getWifiConfig',
      'updateWifiConfig',
      'getWifiAdvanced',
      'updateWifiAdvanced',
      'getPptpClient',
      'updatePptpClient',
      'getPptpServer',
      'updatePptpServer',
      'getL2tpServer',
      'updateL2tpServer',
      'getVpnUsers',
      'updateVpnUsers',
      'getL2tpClient',
      'updateL2tpClient',
      'getVpnStatus',
      'disconnectVpnUser',
      'getOpenVpn',
      'updateOpenVpn',
      'uploadOpenVpn',
      'getWirelessAcl',
      'updateWirelessAcl',
      'getConnectedDevices',
      'getDeviceAclList',
      'addDeviceAcl',
      'removeDeviceAcl',
      'runDiagnostic',
      'startDiagnostic',
      'pollDiagnostic',
      'stopDiagnostic',
      'changeAdminPassword',
      'getFirmwareInfo',
      'uploadFirmware',
      'getSystemTime',
      'updateSystemTime',
      'getScheReboot',
      'updateScheReboot',
      'getSystemLogs',
      'updateSyslog',
      'clearSyslog',
      'backupConfig',
      'downloadBackup',
      'restoreConfig',
      'rebootDevice',
      'factoryReset',
    ])
    for (const method of methods) {
      expect(FACTORY_CGI_CONTRACT[method]?.captured, method).toBe(capturedMethods.has(method))
      expect(typeof sample[method]).toBe('function')
    }
  })

  it('production adapter source does not target the 25.12 cgi path', () => {
    const src = readFileSync(
      resolve(repoRoot, 'src/api/adapters/factory-cgi-adapter.ts'),
      'utf8',
    )
    expect(src).not.toContain('/cgi-bin/mp716')
    expect(src).not.toMatch(/username\s*===?\s*['"]admin['"]/)
    expect(src).not.toContain("user = 'root'")
    expect(src).not.toContain('user=root')
  })
})
