<script setup>
import { shallowRef, ref } from 'vue'

const token = ref('')
const password = ref('')
const file = shallowRef(null)
const report = shallowRef(null)
const error = ref('')
const busy = ref(false)
const network = shallowRef(null)

async function api(path, body, contentType, method = 'POST') {
  const headers = contentType ? { 'Content-Type': contentType } : {}
  if (token.value) headers.Authorization = `Bearer ${token.value}`
  const response = await fetch(`/cgi-bin/mp716/${path}`, { method, headers, body })
  if (response.status === 401) token.value = ''
  const result = await response.json()
  if (!response.ok || result.ok !== true) throw new Error(result.message || '请求失败')
  return result.data
}

async function submit(action) {
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (cause) {
    error.value = cause.message
  } finally {
    busy.value = false
  }
}

function login() {
  const body = JSON.stringify({ username: 'admin', password: password.value })
  password.value = ''
  return submit(async () => {
    const session = await api('auth/login', body, 'application/json')
    token.value = session.token
    network.value = await api('network/status', undefined, undefined, 'GET')
  })
}

function logout() {
  return submit(async () => {
    try {
      await api('auth/logout', null, 'application/json')
    } finally {
      token.value = ''
      file.value = null
      report.value = null
      network.value = null
    }
  })
}

function refreshNetwork() {
  return submit(async () => {
    network.value = await api('network/status', undefined, undefined, 'GET')
  })
}

function pickFile(event) {
  file.value = event.target.files?.[0] || null
  report.value = null
}

function verify() {
  report.value = null
  return submit(async () => {
    if (!file.value || !file.value.name.toLowerCase().endsWith('.mp716upd')) {
      throw new Error('请选择 .mp716upd 固件包')
    }
    report.value = await api('system/firmware-package/verify', file.value, 'application/octet-stream')
  })
}
</script>

<template>
  <main>
    <header>
      <div>
        <p>MP716</p>
        <h1>固件管理</h1>
      </div>
      <button v-if="token" type="button" class="secondary" :disabled="busy" @click="logout">退出</button>
    </header>

    <form v-if="!token" @submit.prevent="login">
      <label for="password">设备管理员密码</label>
      <input id="password" v-model="password" type="password" autocomplete="current-password" required>
      <button type="submit" :disabled="busy">登录</button>
    </form>

    <template v-else>
      <section aria-labelledby="network-heading">
        <h2 id="network-heading">网络状态</h2>
        <button type="button" class="secondary" :disabled="busy" @click="refreshNetwork">刷新状态</button>
        <dl v-if="network">
          <template v-for="(iface, name) in network.interfaces" :key="name">
            <dt>{{ name.toUpperCase() }}</dt>
            <dd>{{ iface.up ? '已连接' : '未连接' }} · {{ iface.device }} · {{ iface.protocol }}</dd>
            <dt>{{ name.toUpperCase() }} IPv4</dt>
            <dd>{{ iface.addresses.map(item => `${item.address}/${item.mask}`).join(', ') || '未获取' }}</dd>
          </template>
          <dt>UPnP 配置</dt><dd>{{ network.upnpEnabled ? '启用' : '关闭' }}</dd>
        </dl>
        <p class="muted">此处显示当前运行系统的状态，不能代表候选固件已经通过实机验收。</p>
      </section>
      <form @submit.prevent="verify">
        <label for="package">签名固件包</label>
        <input id="package" type="file" accept=".mp716upd" required @change="pickFile">
        <button type="submit" :disabled="busy || !file">上传并校验</button>
      </form>
      <p class="muted">当前阶段仅开放校验，固件写入已关闭。</p>
      <dl v-if="report" aria-live="polite">
        <dt>验签结果</dt><dd>{{ report.signature_checked ? '通过' : '未通过' }}</dd>
        <dt>固件版本</dt><dd>{{ report.firmware_version }}</dd>
        <dt>载荷 SHA-256</dt><dd class="hash">{{ report.payload_sha256 }}</dd>
      </dl>
    </template>
    <p v-if="busy" role="status">正在处理…</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </main>
</template>

<style>
:root { font: 16px/1.5 "Inter", "Microsoft YaHei", system-ui, sans-serif; color: #172822; background: #edf2ef; }
body { margin: 0; }
main { max-width: 36rem; margin: 10vh auto 0; padding: clamp(1.25rem, 5vw, 2.5rem); background: white; border: 1px solid #d9e3dd; border-radius: 1rem; }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
header p { margin: 0; font-size: .85rem; font-weight: 700; color: #206340; }
h1 { margin: .15rem 0 0; font-size: 1.75rem; }
form { display: grid; gap: .7rem; }
label, dt { font-weight: 600; }
input, button { font: inherit; }
input { min-width: 0; padding: .6rem; border: 1px solid #aabbb2; border-radius: .4rem; }
button { justify-self: start; padding: .55rem 1rem; border: 1px solid #175d3a; border-radius: .4rem; color: white; background: #175d3a; }
button.secondary { color: #175d3a; background: white; }
button:disabled { opacity: .55; }
.muted { color: #465b50; }
dd { margin: .25rem 0 .8rem; }
.hash { overflow-wrap: anywhere; font-family: ui-monospace, monospace; }
[role="alert"] { color: #a1282a; }
@media (max-width: 42rem) { main { margin: 1rem; } }
</style>
