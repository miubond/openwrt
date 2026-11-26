# 实验室闭环烟测：登录、能力、固件门、首页 WAN 速率二次采样（不重刷机）
param(
  [string]$RouterHost = $(if ($env:ROUTER_HOST) { $env:ROUTER_HOST } else { '192.168.199.1' })
)
$ErrorActionPreference = 'Stop'
$pwd = $env:ROUTER_SSH_PASSWORD
if (-not $pwd) { $pwd = $env:ROUTER_ROOT_PASSWORD }
if (-not $pwd) { throw 'Set ROUTER_SSH_PASSWORD or ROUTER_ROOT_PASSWORD' }

$base = "http://${RouterHost}/cgi-bin/mp716"
$pre = Invoke-RestMethod -Uri "$base/auth/prelogin" -Method GET
if (-not $pre.ok) { throw 'prelogin failed' }

$login = Invoke-RestMethod -Uri "$base/auth/login" -Method POST `
  -Body (@{ username = 'root'; password = $pwd } | ConvertTo-Json -Compress) -ContentType 'application/json'
$token = $login.data.token
$h = @{ Authorization = "Bearer $token" }

Invoke-RestMethod -Uri "$base/system/ping" -Headers $h | Out-Null

$cap = Invoke-RestMethod -Uri "$base/system/capabilities" -Headers $h
if ($cap.data.apiContract -ne 'mp716-native/v1') { throw 'capabilities: bad apiContract' }
if (-not $cap.data.firmwareUpgrade) { throw 'capabilities: firmwareUpgrade=false' }
if ($cap.data.bundle.multiSsid -ne $true) { throw 'capabilities: multiSsid should be true' }
$sec = Invoke-RestMethod -Uri "$base/wireless/secondary" -Headers $h
if ($sec.data.supported -ne $true) { throw 'wireless/secondary: supported=false' }
$cell = Invoke-RestMethod -Uri "$base/network/cellular" -Headers $h
if ($cell.data.supported -eq $true) { throw 'network/cellular: must not claim modem' }

$fw = Invoke-RestMethod -Uri "$base/system/firmware" -Headers $h
if (-not $fw.data.canUpgrade) { throw 'firmware: canUpgrade=false' }
if ($env:LAB_EXPECT_FLASH -eq '1' -and $fw.data.flashUpgradeEnabled -ne $true) {
  throw 'firmware: lab expects flashUpgradeEnabled=true (DEPLOY_ENABLE_FLASH=1)'
}

$d1 = (Invoke-RestMethod -Uri "$base/home/dashboard" -Headers $h).data.wan
Start-Sleep -Seconds 2
$d2 = (Invoke-RestMethod -Uri "$base/home/dashboard" -Headers $h).data.wan
Write-Host "OK firmware canUpgrade=$($fw.data.canUpgrade) flash=$($fw.data.flashUpgradeEnabled)"
Write-Host "WAN rates: t0 ready=$($d1.ratesReady) rx=$($d1.rxRateBps) | t2s ready=$($d2.ratesReady) rx=$($d2.rxRateBps)"
if ($d2.ratesReady -ne $true -and $d1.ratesReady -ne $true) {
  Write-Warning 'WAN rate sample not ready after 2s'
}
Write-Host 'CLOSED_LOOP_SMOKE_OK'