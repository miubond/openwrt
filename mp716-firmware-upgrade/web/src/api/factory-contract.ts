/**
 * 原厂 CGI 黑盒契约。
 * captured=false 表示尚未从浏览器 Network 或原厂 bundle 录到真实 URL、方法、Content-Type 和字段。
 * 未录制前禁止按 cgi 文件名补 action。
 */
export interface UncapturedCgiEntry {
  captured: false
  feature: string
  vueRoute: string
  /** 仅记录二进制存在性，不代表该功能的请求已落到这个文件 */
  cgiPresence: 'listed-on-device' | 'unknown'
  evidence: string
}

export interface CapturedCgiEntry {
  captured: true
  feature: string
  vueRoute: string
  method: 'POST'
  path: string
  contentType: 'application/json'
  evidence: string
}

export type FactoryCgiEntry = UncapturedCgiEntry | CapturedCgiEntry

export { HUAYI_HYID, MODEM_HYID } from './factory-hyid'

export const FACTORY_CGI_CONTRACT: Record<string, FactoryCgiEntry> = {
  login: {
    captured: true,
    feature: '登录',
    vueRoute: '/login',
    method: 'POST',
    path: '/cgi-bin/cgi_huayi.cgi',
    contentType: 'application/json',
    evidence:
      '实机 main.9b45205a：POST cgi_huayi.cgi，JSON {hy_username, hy_userpwd: md5(明文), HYID:5}。错误密码返回 errcode 4006。用户名原样提交，不改写成 root。成功只靠 Cookie，响应里没有 token。',
  },
  logout: {
    captured: true,
    feature: '登出',
    vueRoute: '/login',
    method: 'POST',
    path: '/cgi-bin/cgi_huayi.cgi',
    contentType: 'application/json',
    evidence: '实机 main.9b45205a：POST cgi_huayi.cgi，JSON {HYID:6}，errcode 2000 后清会话。',
  },
  ping: entry('会话探活', '/', '原厂是否提供探活接口未知。'),
  getPreLoginConfig: captured(
    '预登录配置',
    '/login',
    'main.9b45205a：POST HYID 0 get_pre_login_config。读 first_boot、need_authorized。first_boot=1 且 need_authorized=0 时直接进 #/wizard；need_authorized=1 时进登录。登录成功且 first_boot=1 时进向导。',
  ),
  getQuickSetting: captured(
    '向导读取',
    '/wizard',
    'main.9b45205a：POST HYID 9 get_quick_setting_config。huayi_r 含 first_boot、wan_type、proto、有线/蜂窝/APN 字段与 ssid_config（ssid_2g、encry_2g、passphrase_2g）。first_boot 为 0 时跳转首页。',
  ),
  applyQuickSetting: captured(
    '向导保存',
    '/wizard',
    'main.9b45205a：POST HYID 10 set_quick_setting_config，合并 WAN 负载与 ssid_config 字段。成功响应含 progresstime、reconnection、reconnection_addr。',
  ),
  completeWizardFirstBoot: captured(
    '向导跳过',
    '/wizard',
    'main.9b45205a：POST HYID 185 set_first_boot，body {first_boot:0}。跳过或完成后进首页。',
  ),
  getSystemInfo: captured(
    '设备概览',
    '/',
    '实机 main.9b45205a：POST cgi_huayi.cgi，JSON {HYID:107} get_home_system_info。首页读 pro_name、fw_version、domain、time_day、uptime、device_umber。没有主机名、OpenWrt 版本或 CPU/内存。',
  ),
  getDeviceInfo: captured(
    '设备信息',
    '/advanced/system/device',
    '实机 main.9b45205a：POST cgi_huayi.cgi，JSON {HYID:45} get_system_info。读 product_name、product_model、software_version、webui_version、lan_mac、ip_address。',
  ),
  getSystemStatus: captured(
    '接口与资源状态',
    '/',
    '与 get_home_system_info 同一请求，只取 uptime。分口状态、CPU、内存不在该响应里。',
  ),
  getWanStatus: captured(
    'WAN 状态',
    '/network/wan-status',
    '实机 main.9b45205a：POST cgi_huayi.cgi，JSON {HYID:25} get_network_info。广域网状态页读 huayi_r.wan_infos 的 mac_addr、ip_addr、subnet_mask、gateway、mtu_num、dns_server_addr_addr、link、tx_bps、rx_bps。',
  ),
  getWanConfig: captured(
    'WAN 配置读取',
    '/network/wan',
    '实机上网设置页 POST cgi_modem.cgi，JSON {HYID:1}。有线 DHCP 返回 wan_mode、proto、hostname、mac_addr、def_mac_addr、cc_mtu、ppp_mtu。地址字段只有空格时按空值。DNS 优先 dns_arr，否则 dns_usb_arr。克隆 MAC 另读 cgi_huayi.cgi HYID 23 get_current_user_info.usr_mac。',
    '/cgi-bin/cgi_modem.cgi',
  ),
  updateWanConfig: captured(
    'WAN 保存',
    '/network/wan',
    '实机 POST cgi_modem.cgi，JSON HYID 2。DHCP 带 wan_mode、proto、cc_mtu、hostname、mac_addr。静态另带地址、掩码、网关、dns_arr。PPPoE 带 ppp_mtu、ac、service、usr、pwd。',
    '/cgi-bin/cgi_modem.cgi',
  ),
  getLanStatus: captured(
    'LAN 状态',
    '/network/lan-status',
    '实机 main.9b45205a：POST cgi_huayi.cgi，JSON {HYID:25} get_network_info。局域网状态页读 huayi_r.lan_infos 的 mac_addr、ip_addr、subnet_mask、client_sum。不含 DHCP 开关与流量计数。',
  ),
  getLanConfig: captured(
    'LAN 配置读取',
    '/network/dhcp',
    '实机 cgi_huayi.cgi HYID 28 get_lan_config。huayi_r 只有 ip_addr、subnet_mask。没有 DHCP Relay。',
  ),
  updateLanConfig: captured(
    'LAN 保存',
    '/network/lan',
    '实机先读 HYID 28，再把整包带回，POST HYID 29 set_lan_config。页面只改 ip_addr、subnet_mask。',
  ),
  getDhcpConfig: captured(
    'DHCP 读取',
    '/network/dhcp',
    '实机 cgi_huayi.cgi HYID 26 get_dhcps_server_config。字段 dhcp_enable、start_ip、end_ip、lease_time（秒）、min_ip、max_ip、static_dhcp_arr。没有网关、DNS 和动态租约。',
  ),
  updateDhcpConfig: captured(
    'DHCP 保存',
    '/network/dhcp',
    '实机把当前 huayi_r 整包带回，POST HYID 27 set_dhcps_server_config。只改 dhcp_enable、start_ip、end_ip、lease_time，保留 static_dhcp_arr。',
  ),
  updateDhcpStaticBindings: captured(
    'DHCP 静态绑定',
    '/network/dhcp',
    '实机先读 HYID 26，再把 huayi_r 整包带回，POST HYID 27，只改 static_dhcp_arr（ip_addr、mac_addr、name），其余字段保留。',
  ),
  getDnsConfig: entry('DNS 读取', '/network/dns', 'DNS 页面请求未抓包。'),
  updateDnsConfig: entry('DNS 保存', '/network/dns', 'DNS 保存请求未抓包。'),
  getQosCapability: entry('QoS 能力', '/network/qos', '原厂 QoS 实现未抓包，禁止改业务服务。'),
  getQosConfig: entry('QoS 读取', '/network/qos', 'QoS 读取请求未抓包。'),
  updateQosConfig: entry('QoS 保存', '/network/qos', 'QoS 保存请求未抓包。'),
  getWifiStatus: captured(
    '无线状态',
    '/',
    '实机 main.9b45205a：POST cgi_huayi.cgi，JSON {HYID:108} get_home_network_info。首页读 huayi_r.wireless_arr[0] 的 status、ssid、channel、auto_channel、band、client_sum、auth_mode、bssid。channel 0 表示 AUTO；auto_channel=1 时信道旁标注 (AUTO)。',
  ),
  getWifiConfig: captured(
    '无线配置读取',
    '/wifi/basic',
    '实机 cgi_huayi.cgi HYID 49 get_wireless_basic_config，wifi_radio=0。字段 wifi_admin、ssid、hwmode、band、channel、tx_power、hidden、noforward、max_num、auth_mode、cipher_mode、key。',
  ),
  updateWifiConfig: captured(
    '无线保存',
    '/wifi/basic',
    '实机 POST HYID 50 set_wireless_basic_config，并带 wifi_radio=0。关闭时整包带回且 wifi_admin=0。开启时提交开关、隔离、频宽、模式、信道、功率、SSID、终端数、auth_mode、cipher_mode、key。',
  ),
  getWirelessClients: entry('无线终端', '/wifi/clients', 'iwpriv 采集方式已知，原厂页面请求未抓包。'),
  getWifiAdvanced: captured(
    '无线高级',
    '/wifi/advanced',
    '实机 cgi_huayi.cgi HYID 83 get_wireless_adv_cfg，wifi_radio=0。字段 bgprotect_mode、beacon、dtim、rts_thres、frag_thres、tx_burst、tx_preamble、wmm。无线开关来自 HYID 49 的 wifi_admin。',
  ),
  updateWifiAdvanced: captured(
    '无线高级保存',
    '/wifi/advanced',
    '实机把当前配置整包带回，POST HYID 84 set_wireless_adv_cfg，并带 wifi_radio=0。',
  ),
  getWirelessAcl: captured(
    '无线 ACL',
    '/wifi/acl',
    '实机 cgi_huayi.cgi HYID 95 get_wireless_acl_cfg，wifi_radio=0。wifi_admin：0 关闭、1 允许、2 拒绝。名单是 macfilter_arr[].mac_addr。',
  ),
  updateWirelessAcl: captured(
    '无线 ACL 保存',
    '/wifi/acl',
    '实机 POST HYID 96 set_wireless_alc_cfg，整包带回，并带 wifi_radio=0。整表只有一种允许或拒绝。',
  ),
  getPptpClient: captured(
    'PPTP 客户端',
    '/advanced/vpn/pptp',
    '实机 cgi_huayi.cgi HYID 163 get_pptp_client_config。huayi_r 有 pptp_enable、pptp_status、pptp_addr、server_addr、usr、pwd、mppe、route_type、pptp_static_arr。',
  ),
  getPptpServer: captured(
    'PPTP 服务器',
    '/advanced/vpn/pptpd',
    '实机 cgi_huayi.cgi HYID 159 get_pptpd_server_config。字段 pptpd_enable、地址池、server_addr、mppe、dns_enable、primary_dns、secondary_dns、mtu、mru，以及用于冲突检查的 xl2tpd 地址池。',
  ),
  updatePptpServer: captured(
    'PPTP 服务器保存',
    '/advanced/vpn/pptpd',
    '实机 POST HYID 158。关闭时把原包的 pptpd_enable 设为 false。开启时整包带回，并检查地址池顺序、与 L2TP 地址池冲突、服务器和客户端不能在同一 /24。',
  ),
  getL2tpServer: captured(
    'L2TP 服务器',
    '/advanced/vpn/xl2tpd',
    '实机 cgi_huayi.cgi HYID 161 get_xl2tpd_server_config。字段 xl2tpd_enable、地址池、server_addr、ipsec_enable、ipsec_key、DNS、mtu、mru。',
  ),
  getL2tpClient: captured(
    'L2TP 客户端',
    '/advanced/vpn/xl2tp',
    '实机 cgi_huayi.cgi HYID 165 get_l2tp_client_config。开关是 xl2tp_enable，状态是 xl2tp_status，地址是 xl2tp_addr。服务器、账号、密码和 ipsec_key 在保存时覆盖。',
  ),
  updateL2tpClient: captured(
    'L2TP 客户端保存',
    '/advanced/vpn/xl2tp',
    '实机 POST HYID 164。关闭且原本已关闭时不提交；从开启改为关闭只带 xl2tp_enable:false。开启时整包带回并覆盖 server_addr、usr、pwd、ipsec_key。服务器模式开启时不能开客户端。',
  ),
  getVpnStatus: captured(
    'VPN 用户状态',
    '/advanced/vpn/status',
    '实机 cgi_huayi.cgi HYID 168 get_vpn_user_onlien。在线表是 usr_arr 的 account、account_type、ip_addr、device_addr、jointime、pid。',
  ),
  disconnectVpnUser: captured(
    '断开 VPN 用户',
    '/advanced/vpn/status',
    '实机 POST HYID 171 set_vpn_user_onlien，只带 pid。',
  ),
  getOpenVpn: captured(
    'OpenVPN 客户端',
    '/advanced/vpn/openvpn',
    '实机 cgi_huayi.cgi HYID 191 get_openvpn_config。字段 enable、status、option、host_name、usr、pwd、port。status 1 为已连接，0 为失败，其他为未连接。',
  ),
  updateOpenVpn: captured(
    'OpenVPN 客户端保存',
    '/advanced/vpn/openvpn',
    '实机 POST HYID 192。关闭只带 enable。表单模式整包带回 host_name、usr、pwd、port。上传模式只带 enable 和 option，且必须先上传配置文件。',
  ),
  uploadOpenVpn: captured(
    'OpenVPN 文件',
    '/advanced/vpn/openvpn',
    '配置文件 POST cgi_stream.cgi?streamid=7，认证文件 POST streamid=8&name=文件名。FormData 字段 userfile，超过 1M 不上传。',
    '/cgi-bin/cgi_stream.cgi',
  ),
  getVpnUsers: captured(
    'VPN 用户',
    '/advanced/vpn/users',
    '实机 cgi_huayi.cgi HYID 167 get_vpn_user_config。用户在 vpnusr_arr，类型在 vpn_type_arr，地址池是 pptpd_start_addr、pptpd_end_addr、xl2tpd_start_addr、xl2tpd_end_addr。',
  ),
  updateVpnUsers: captured(
    'VPN 用户保存',
    '/advanced/vpn/users',
    '实机 POST HYID 166，只带 vpnusr_arr。每项有 authenticate、usr、pwd、remote_addr、com、route_arr。最多 32 个，用户名不能重复。分配 IP 必须落在对应地址池。',
  ),
  updateL2tpServer: captured(
    'L2TP 服务器保存',
    '/advanced/vpn/xl2tpd',
    '实机 POST HYID 160。关闭时把原包的 xl2tpd_enable 设为 false。开启时整包带回，并检查地址池顺序和与 PPTP 地址池的冲突。',
  ),
  updatePptpClient: captured(
    'PPTP 客户端保存',
    '/advanced/vpn/pptp',
    '实机 POST HYID 162 set_pptp_client_config。关闭时只把原包的 pptp_enable 设为 false；开启时整包带回并覆盖服务器、账号、密码、MPPE、路由模式和静态路由。密码明文提交，不做 MD5。',
  ),
  getConnectedDevices: captured(
    '在线终端',
    '/',
    '实机 main.9b45205a：POST cgi_huayi.cgi，JSON {HYID:46} get_allstalist。在线表读 huayi_r.staline_arr 的 ip_addr、mac_addr、host_name。没有有线/无线标记。',
  ),
  getDeviceAclList: captured(
    '终端 ACL 列表',
    '/devices',
    'main.9b45205a：POST HYID 60 get_acl_list。读 huayi_r.acl_arr[].acl_addr。',
  ),
  addDeviceAcl: captured(
    '终端 ACL 加入',
    '/devices',
    'main.9b45205a：POST HYID 61 add_acl_list，body {acl_addr}。',
  ),
  removeDeviceAcl: captured(
    '终端 ACL 移除',
    '/devices',
    'main.9b45205a：POST HYID 62 delete_acl_list，body {acl_addr}。',
  ),
  disconnectDevice: entry('断开终端', '/devices/online', '踢线请求未抓包。'),
  getFirewallRules: entry('防火墙读取', '/advanced/firewall', '防火墙请求未抓包。'),
  updateFirewallRules: entry('防火墙保存', '/advanced/firewall', '防火墙保存请求未抓包。'),
  getPortForwards: entry('端口转发读取', '/advanced/port-forward', '端口映射请求未抓包。'),
  updatePortForwards: entry('端口转发保存', '/advanced/port-forward', '端口映射保存请求未抓包。'),
  runDiagnostic: captured(
    '网络诊断',
    '/advanced/diagnose',
    'Ping：HYID 66 带 dest_host_addr、start_host_addr、ping_num，再轮询 HYID 65，读 ping_detct 与 action_content。路由跟踪：HYID 69 带 max_hops、timeout，轮询 HYID 68。DHCP 检测：HYID 32，轮询 HYID 31 的 action_arr。',
  ),
  startDiagnostic: captured(
    '开始检测',
    '/advanced/tool/ping',
    'main.9b45205a：Ping HYID 66，字段 dest_host_addr、start_host_addr、ping_num。路由跟踪 HYID 69，字段 dest_host_addr、max_hops、timeout。DHCP HYID 32，无额外字段。',
  ),
  pollDiagnostic: captured(
    '检测结果',
    '/advanced/tool/ping',
    'Ping 轮询 HYID 65，标志 ping_detct，正文 action_content，间隔 3 秒。路由跟踪轮询 HYID 68，标志 tracert_detect，间隔 5 秒。DHCP 轮询 HYID 31，标志 ping_detct，列表 action_arr，间隔 5 秒。标志 1 为进行中，0 或 2 为结束。',
  ),
  stopDiagnostic: captured(
    '停止检测',
    '/advanced/tool/ping',
    'main.9b45205a：停止 Ping HYID 67 stop_ping_detect，停止路由跟踪 HYID 70 stop_tracert_detect，停止 DHCP 检测 HYID 33 stop_dhcp_detect。',
  ),
  changeAdminPassword: captured(
    '管理密码',
    '/system/password',
    '实机先读 HYID 7 get_passwd_state 的 randomname。大于 1594 时 POST HYID 8，hy_prepwd 与 hy_newpwd 都是 MD5。否则只提交 hy_newpwd 的 MD5。',
  ),
  getSystemTime: captured(
    'NTP 读取',
    '/advanced/system/time',
    '实机 cgi_huayi.cgi HYID 34 get_ntp_config。字段 ntp_admin、time_zone、ntp_server_arr（3 个）、time_day（unix 秒）。',
  ),
  updateSystemTime: captured(
    'NTP 保存',
    '/advanced/system/time',
    '实机 POST HYID 35 set_ntp_config，只带 ntp_admin、time_zone、ntp_server_arr。关闭时服务器列表用读取到的原数组。',
  ),
  useBrowserTime: captured(
    '使用浏览器时间',
    '/advanced/system/time',
    '实机 POST cgi_huayi.cgi HYID 36 use_browser_time，带 current_time（YYYY-MM-DD HH:mm:ss）。',
  ),
  getScheReboot: captured(
    '定时重启',
    '/advanced/system/sche-reboot',
    '实机 cgi_huayi.cgi HYID 41 get_sche_reboot_config。字段 sche_mode、rectime、hour、minute、weeks、time_day、remaining。',
  ),
  updateScheReboot: captured(
    '定时重启保存',
    '/advanced/system/sche-reboot',
    '实机 POST HYID 42 set_sche_reboot_config。关闭只带 sche_mode；倒计时带 rectime 且不少于 600 秒；指定时间带 weeks、hour、minute、rectime。',
  ),
  getFirmwareInfo: captured(
    '固件信息',
    '/advanced/system/upgrade',
    '实机 cgi_huayi.cgi HYID 22 get_upgrade_info。huayi_r 使用 pro_model、fw_version、release_time、maxsize、maxsize_tip。不展示空的 module_version。',
  ),
  uploadFirmware: captured(
    '固件升级',
    '/advanced/system/upgrade',
    '实机 POST cgi_stream.cgi?streamid=4&keep_setting=1 或 0，FormData 字段 userfile。默认保留配置。超过 maxsize 时不上传。',
  ),
  getSystemLogs: captured(
    '系统日志',
    '/advanced/system/log',
    '实机 cgi_huayi.cgi HYID 37 get_syslog_config 读 syslog_admin，HYID 39 display_syslog 读 huayi_r.log_content 整段文本。',
  ),
  updateSyslog: captured(
    '系统日志开关',
    '/advanced/system/log',
    '实机 POST HYID 38 set_syslog_config，只带 syslog_admin。',
  ),
  clearSyslog: captured(
    '清除系统日志',
    '/advanced/system/log',
    '实机 POST cgi_huayi.cgi，JSON {HYID:40} clean_syslog。',
  ),
  backupConfig: captured(
    '配置备份',
    '/system/backup',
    '原厂下载链接是 GET cgi_stream.cgi?streamid=2，文件名 Configfile。backupConfig 只返回这个文件名。',
    '/cgi-bin/cgi_stream.cgi',
  ),
  downloadBackup: captured(
    '下载备份',
    '/system/backup',
    'GET cgi_stream.cgi?streamid=2，保存为 Configfile。',
    '/cgi-bin/cgi_stream.cgi',
  ),
  restoreConfig: captured(
    '配置恢复',
    '/system/backup',
    'POST cgi_stream.cgi?streamid=3，FormData 字段 userfile。超过 2097152 字节时不上传，提示文件不能大于2M。',
    '/cgi-bin/cgi_stream.cgi',
  ),
  getConfigTaskStatus: entry('应用确认状态', '/', '原厂是否有确认计时器未知。'),
  confirmConfigTask: entry('应用确认', '/', '确认请求未抓包。'),
  rebootDevice: captured(
    '重启',
    '/system/reboot',
    '实机 POST cgi_huayi.cgi，JSON {HYID:2} restart。没有额外字段。',
  ),
  factoryReset: captured(
    '恢复出厂',
    '/system/reboot',
    '实机 POST cgi_huayi.cgi，JSON {HYID:21} reset。没有额外字段。',
  ),
}

function captured(
  feature: string,
  vueRoute: string,
  evidence: string,
  path = '/cgi-bin/cgi_huayi.cgi',
): CapturedCgiEntry {
  return {
    captured: true,
    feature,
    vueRoute,
    method: 'POST',
    path,
    contentType: 'application/json',
    evidence,
  }
}

function entry(feature: string, vueRoute: string, evidence: string): UncapturedCgiEntry {
  return {
    captured: false,
    feature,
    vueRoute,
    cgiPresence: 'unknown',
    evidence,
  }
}
