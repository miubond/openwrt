# 签名 release 包验收：验签 →（可选）刷写 → 重启后核对（刷写需 CONFIRM_RELEASE_FLASH=YES）
param(
  [Parameter(Mandatory)][string]$PackagePath,
  [string]$RouterHost = $(if ($env:ROUTER_HOST) { $env:ROUTER_HOST } else { '192.168.199.1' }),
  [switch]$Flash
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $PackagePath)) { throw "Missing package: $PackagePath" }
$pwd = $env:ROUTER_SSH_PASSWORD; if (-not $pwd) { $pwd = $env:ROUTER_ROOT_PASSWORD }
if (-not $pwd) { throw 'Set ROUTER_SSH_PASSWORD' }

$base = "http://${RouterHost}/cgi-bin/mp716"
$login = Invoke-RestMethod -Uri "$base/auth/login" -Method POST `
  -Body (@{ username = 'root'; password = $pwd } | ConvertTo-Json -Compress) -ContentType 'application/json'
$h = @{ Authorization = "Bearer $($login.data.token)" }
$bytes = [IO.File]::ReadAllBytes((Resolve-Path $PackagePath))

# verify
$r = Invoke-WebRequest -Uri "$base/system/firmware-package/verify" -Method POST -Headers @{
  Authorization = $h.Authorization; 'X-Mp716-Upgrade-Mode' = 'verify'
} -Body $bytes -ContentType 'application/octet-stream'
$body = $r.Content | ConvertFrom-Json
if (-not $body.ok) { throw "Verify failed: $($r.Content)" }
Write-Host "OK verify signature_checked=$($body.data.signature_checked)"

if ($Flash) {
  if ($env:CONFIRM_RELEASE_FLASH -ne 'YES') {
    throw 'Set CONFIRM_RELEASE_FLASH=YES to flash (device will reboot)'
  }
  $fr = Invoke-WebRequest -Uri "$base/system/firmware-package/verify" -Method POST -Headers @{
    Authorization = $h.Authorization; 'X-Mp716-Upgrade-Mode' = 'flash'; 'X-Mp716-Keep-Settings' = '1'
  } -Body $bytes -ContentType 'application/octet-stream' -TimeoutSec 300
  Write-Host "Flash response: $($fr.Content)"
  Write-Host 'WAIT: device rebooting — re-run with -PostRebootCheck after boot'
  exit 0
}

if ($env:POST_REBOOT_CHECK -eq '1') {
  Start-Sleep -Seconds 5
  $fw = Invoke-RestMethod -Uri "$base/system/firmware" -Headers $h
  $dev = Invoke-RestMethod -Uri "$base/system/device" -Headers $h
  Write-Host "Post-reboot version=$($fw.data.currentVersion) device=$($dev.data.softwareVersion)"
}

Write-Host 'RELEASE_FLASH_E2E_VERIFY_OK'