# 量产策略烟测：刷写门关闭时须 validationOnly（不自动 touch allow-flash）
param(
  [string]$RouterHost = $(if ($env:ROUTER_HOST) { $env:ROUTER_HOST } else { '192.168.199.1' })
)
$ErrorActionPreference = 'Stop'
$pwd = $env:ROUTER_SSH_PASSWORD
if (-not $pwd) { $pwd = $env:ROUTER_ROOT_PASSWORD }
if (-not $pwd) { throw 'Set ROUTER_SSH_PASSWORD or ROUTER_ROOT_PASSWORD' }

$base = "http://${RouterHost}/cgi-bin/mp716"
$login = Invoke-RestMethod -Uri "$base/auth/login" -Method POST `
  -Body (@{ username = 'root'; password = $pwd } | ConvertTo-Json -Compress) -ContentType 'application/json'
$token = $login.data.token
$h = @{ Authorization = "Bearer $token" }

$fw = Invoke-RestMethod -Uri "$base/system/firmware" -Headers $h
$cap = Invoke-RestMethod -Uri "$base/system/capabilities" -Headers $h

if ($fw.data.flashUpgradeEnabled -eq $true) {
  throw 'production: flashUpgradeEnabled must be false (热更勿设 DEPLOY_ENABLE_FLASH，并确认无 allow-flash-upgrade)'
}
if ($fw.data.validationOnly -ne $true) {
  throw 'firmware: validationOnly must be true for production policy'
}
if ($cap.data.firmwareFlashEnabled -eq $true) {
  throw 'capabilities: firmwareFlashEnabled must be false'
}
if ($cap.data.bundle.multiSsid -ne $true) { throw 'capabilities: multiSsid should be true (guest AP API)' }
if ($cap.data.bundle.cellular -ne $false) { throw 'capabilities: bundle.cellular menu flag stays false' }
if ($cap.data.cellular.supported -eq $true) { throw 'capabilities: cellular.supported must be false on MP716' }
if ($cap.data.cellular.reason -ne 'no_modem') { throw 'capabilities: cellular.reason should be no_modem' }

Write-Host "OK production policy firmware validationOnly=$($fw.data.validationOnly) flash=$($fw.data.flashUpgradeEnabled)"
Write-Host 'PRODUCTION_CLOSED_LOOP_OK'