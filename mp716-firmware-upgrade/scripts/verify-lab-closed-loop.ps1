# 实验室闭环烟测：登录、固件能力、首页 WAN 速率二次采样（不重刷机）
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
if (-not $fw.data.canUpgrade) { throw 'firmware: canUpgrade=false' }
Write-Host "OK firmware canUpgrade=$($fw.data.canUpgrade) flash=$($fw.data.flashUpgradeEnabled)"

$d1 = (Invoke-RestMethod -Uri "$base/home/dashboard" -Headers $h).data.wan
Start-Sleep -Seconds 2
$d2 = (Invoke-RestMethod -Uri "$base/home/dashboard" -Headers $h).data.wan
Write-Host "WAN rates: t0 ready=$($d1.ratesReady) rx=$($d1.rxRateBps) | t2s ready=$($d2.ratesReady) rx=$($d2.rxRateBps)"
if ($d2.ratesReady -ne $true -and $d1.ratesReady -ne $true) {
  Write-Warning 'WAN rate sample not ready after 2s (may need >12s on old firmware without wan cache refresh)'
}
Write-Host 'CLOSED_LOOP_SMOKE_OK'