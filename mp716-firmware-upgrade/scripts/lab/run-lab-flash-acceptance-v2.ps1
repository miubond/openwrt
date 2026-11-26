# 实验室两阶段刷写验收：verify → apply →（可选）重启后核对
param(
  [Parameter(Mandatory)][string]$PackagePath,
  [string]$RouterHost = '10.251.0.140',
  [switch]$Flash,
  [switch]$PostReboot
)
if ($env:ROUTER_HOST) { $RouterHost = $env:ROUTER_HOST }
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $PackagePath)) { throw "Missing: $PackagePath" }
$pwd = $env:ROUTER_SSH_PASSWORD
if (-not $pwd) { $pwd = $env:ROUTER_ROOT_PASSWORD }
if (-not $pwd) { throw 'Set ROUTER_SSH_PASSWORD' }

$base = "http://${RouterHost}/cgi-bin/mp716"
$login = Invoke-RestMethod -Uri "$base/auth/login" -Method POST `
  -Body (@{ username = 'root'; password = $pwd } | ConvertTo-Json -Compress) -ContentType 'application/json'
$h = @{ Authorization = "Bearer $($login.data.token)" }
$pkg = (Resolve-Path $PackagePath).Path

$info = Invoke-RestMethod -Uri "$base/system/firmware" -Headers $h
Write-Host "firmware info: policy=$($info.data.upgradePolicy) flash=$($info.data.flashUpgradeEnabled) validationOnly=$($info.data.validationOnly)"

$raw = curl.exe -s -X POST -H "Authorization: Bearer $($login.data.token)" -H "Content-Type: application/octet-stream" `
  --data-binary "@$pkg" "$base/system/firmware-package/verify"
if (-not $raw) { throw 'Empty verify response' }
$body = $raw | ConvertFrom-Json
if (-not $body.ok) { throw "Upload verify failed: $raw" }
$jid = $body.data.job_id
if (-not $jid) { throw 'Missing job_id in verify response' }
Write-Host "OK VERIFIED job_id=$jid flash_write=$($body.data.flash_write)"

if ($PostReboot) {
  Start-Sleep 8
  $fw = Invoke-RestMethod -Uri "$base/system/firmware" -Headers $h -TimeoutSec 30
  $st = Invoke-RestMethod -Uri "$base/system/firmware-v2/status?job_id=$jid" -Headers $h -ErrorAction SilentlyContinue
  Write-Host "Post-reboot version=$($fw.data.currentVersion) buildDate=$($fw.data.buildDate) jobState=$($st.data.state)"
  exit 0
}

if (-not $Flash) {
  Write-Host 'LAB_ACCEPTANCE_VERIFY_OK (no flash)'
  exit 0
}
if ($env:CONFIRM_LAB_FLASH -ne 'YES') {
  throw 'Set CONFIRM_LAB_FLASH=YES to apply firmware'
}

$apply = Invoke-RestMethod -Uri "$base/system/firmware-v2/apply" -Method POST -Headers $h `
  -ContentType 'application/json' -Body (@{ confirm = $true; job_id = $jid; keepSettings = $true } | ConvertTo-Json) -TimeoutSec 300
if (-not $apply.ok) { throw "Apply failed: $($apply | ConvertTo-Json -Compress)" }
Write-Host "OK SUBMITTED flash_write=$($apply.data.flash_write) upgraded=$($apply.data.upgraded)"
Write-Host 'LAB_ACCEPTANCE_FLASH_SUBMITTED — wait reboot then: -PostReboot'