// Local rendering checks only. Network requests are confined to a loopback fixture.
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const project = process.env.MP716_WEB_PROJECT || fileURLToPath(new URL('../..', import.meta.url))
const require = createRequire(resolve(project, 'package.json'))
const { chromium } = require('playwright')
const output = resolve(process.env.MP716_WEB_CHECK_OUTPUT || resolve(project, 'releases/lp-ui-check'))
const dist = resolve(project, process.env.MP716_WEB_DIST || 'dist-openwrt')
await mkdir(output, { recursive: true })
const calls = [], faults = [], screenshots = [], layouts = []
const devices = [
  { id: 'desktop', hostname: 'Desktop fixture', ipv4: '192.168.199.107', mac: '02:00:00:00:00:01', wired: true, online: true, interface: 'br-lan' },
  { id: 'phone', hostname: 'Phone fixture', ipv4: '192.168.199.108', mac: '02:00:00:00:00:02', wired: false, online: true, interface: 'phy0-ap0' },
]
const fixtures = {
  'auth/prelogin': { firstBoot: 0, needAuthorized: 1 },
  'system/ping': { latencyMs: 1 },
  'system/info': { model: 'MP716', hostname: 'mp716-fixture', firmware: '1.0.7', kernel: '6.12.112', uptimeSec: 900, localTime: '2026-11-20 17:30:00', cpuLoad: [], memTotalKb: 64000, memFreeKb: 12000, flashTotalKb: 8192, flashFreeKb: 1000 },
  'network/wan/status': { connected: true, proto: 'dhcp', ipv4: '10.251.0.117', netmask: '255.255.255.0', rxBytes: 7340032, txBytes: 18874368, rxRateBps: 0, txRateBps: 0, dns: [] },
  'network/wan/config': { proto: 'dhcp', mtu: 1500, ccMtu: 1500, macaddr: '02:00:00:00:01:01', wanMode: 'wired', dns: [], hostname: 'fixture' },
  'network/lan/status': { ipv4: '192.168.199.1', netmask: '255.255.255.0', mac: '02:00:00:00:01:02', up: true },
  'network/lan/config': { ip: '192.168.199.1', netmask: '255.255.255.0', dhcp: true },
  'wireless/status': { enabled: true, ssid: 'MP716-fixture', channel: 6, clients: 1, security: 'wpa2-psk', band: '2.4GHz', mode: '11gn', mac: '02:00:00:00:02:01' },
  'wireless/config': { enabled: true, ssid: 'MP716-fixture', hidden: false, band: '2.4GHz', channel: 6, htmode: 'HT20', security: 'wpa2-psk', password: 'fixture-password', isolation: false },
  'home/physical-ports': Array.from({ length: 5 }, (_, i) => ({ id: `port${i}`, label: `P${i}`, role: 'lan', mappingVerified: false, linkKnown: true, linkUp: i >= 3, speedMbps: i >= 3 ? 100 : 0 })),
  'hosts/connected': devices,
  'hosts/device-acl': [],
  'network/dhcp/config': { enabled: true, startIp: '192.168.199.2', endIp: '192.168.199.254', leasetime: '7200', staticBindings: [], leases: [] },
  'system/firmware': { hardware: 'MP716', currentVersion: '1.0.7', maxBytes: 8388608, maxSizeLabel: '8 MiB', flashUpgradeEnabled: false },
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const segment = url.pathname.replace(/^\/cgi-bin\/mp716\//, '')
  if (url.pathname.startsWith('/cgi-bin/mp716/')) {
    calls.push({ method: req.method, path: segment })
    const data = fixtures[segment]
    res.setHeader('Content-Type', 'application/json')
    if (data === undefined || req.method !== 'GET') {
      res.writeHead(400); res.end(JSON.stringify({ ok: false, message: 'Unexpected fixture request' })); return
    }
    res.end(JSON.stringify({ ok: true, data, ts: Date.now() })); return
  }
  try {
    const relative = decodeURIComponent(url.pathname).replace(/^\/mp716\//, '/').replace(/^\//, '') || 'index.html'
    const filename = resolve(dist, relative)
    if (!filename.startsWith(dist + sep)) throw new Error('unsafe path')
    res.setHeader('Content-Type', mime[extname(filename)] || 'application/octet-stream')
    res.end(await readFile(filename))
  } catch { res.writeHead(404); res.end('Not found') }
})
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
let failure
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  await context.addInitScript(() => { localStorage.setItem('mp716_session', 'local-fixture-only') })
  const page = await context.newPage()
  page.setDefaultTimeout(6000)
  page.on('pageerror', e => faults.push(e.message))
  async function visit(path, ready, name, mobile = false) {
    await page.goto(`${origin}/#${path}`)
    await page.locator(ready).first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    const layout = await page.evaluate(() => ({
      viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
      header: document.querySelector('.app-header').getBoundingClientRect().height,
      mainLeft: document.querySelector('.app-main').getBoundingClientRect().left,
    }))
    assert(layout.pageWidth <= layout.viewport, `${name}: page overflow`)
    assert.equal(layout.header, 62, `${name}: LP header height`)
    layouts.push({ page: name, ...layout })
    const filename = `${name}${mobile ? '-mobile' : ''}.png`
    await page.screenshot({ path: resolve(output, filename), fullPage: true })
    screenshots.push(filename)
  }
  await visit('/', '.port.up', 'dashboard')
  assert.match(await page.locator('.rates-traffic').innerText(), /0bps/)
  assert.match(await page.locator('.port-status').last().innerText(), /100M.*已连接/)
  assert.match(await page.locator('.legend').innerText(), /待核验/)
  assert.match(await page.locator('.port-status').last().getAttribute('title'), /100M.*已连接/)
  await visit('/network/wan', '.wan-form', 'wan')
  const field = await page.locator('.field').first().evaluate(el => {
    const a = el.querySelector('.label').getBoundingClientRect(), b = el.querySelector('.control').getBoundingClientRect()
    return { labelBottom: a.bottom, controlTop: b.top }
  })
  assert(field.controlTop >= field.labelBottom, 'LP labels must be above inputs')
  await visit('/network/dhcp', '.dhcp-form', 'dhcp')
  await page.getByRole('button', { name: '+ 添加绑定', exact: true }).click()
  await page.locator('.modal').waitFor()
  await page.screenshot({ path: resolve(output, 'dhcp-add.png'), fullPage: true }); screenshots.push('dhcp-add.png')
  await page.locator('.close-btn').click()
  await page.locator('.header-right > .icon-btn').last().click()
  await page.locator('.dialog').waitFor()
  assert.equal(await page.locator('.dialog .title').evaluate(el => getComputedStyle(el.parentElement).justifyContent), 'space-between')
  await page.screenshot({ path: resolve(output, 'reboot-confirm.png'), fullPage: true }); screenshots.push('reboot-confirm.png')
  await page.locator('.dialog .sec').click()
  await visit('/wifi/basic', '.settings-form', 'wifi')
  await page.locator('.ui-select-trigger').first().click()
  assert.equal(await page.locator('[role="listbox"]:visible').count(), 1)
  await page.keyboard.press('Escape')
  await visit('/devices', '.device-filters', 'devices')
  await page.getByRole('searchbox').fill('Phone')
  assert.equal(await page.locator('tbody tr').count(), 1)
  await page.locator('.detail-action').click()
  assert.match(await page.getByRole('dialog').innerText(), /Phone fixture/)
  await page.screenshot({ path: resolve(output, 'devices-details.png'), fullPage: true }); screenshots.push('devices-details.png')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await visit('/', '.port.up', 'dashboard', true)
  await visit('/network/wan', '.wan-form', 'wan', true)
  await page.locator('.menu-btn').click()
  assert(await page.locator('.app-shell').evaluate(el => el.classList.contains('mobile-open')))
  assert.equal(await page.locator('.subnav').evaluate(el => el.getBoundingClientRect().top), await page.locator('.app-header').evaluate(el => el.getBoundingClientRect().bottom))
  await page.locator('.subnav a').last().click()
  assert(!await page.locator('.app-shell').evaluate(el => el.classList.contains('mobile-open')))
  assert.equal(calls.filter(c => c.method !== 'GET').length, 0)
  assert.deepEqual(faults, [])
} catch (e) { failure = e; }
finally {
  await browser.close(); await new Promise(ok => server.close(ok))
  await writeFile(resolve(output, 'render-check.json'), JSON.stringify({ ok: !failure, scope: 'local loopback fixture only; no device access', screenshots, layouts, faults, calls, error: failure?.stack }, null, 2))
}
if (failure) throw failure
console.log(JSON.stringify({ ok: true, screenshots, requests: calls.length, deviceWrites: 0 }))
