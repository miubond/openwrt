# 生产机在网运行态：策略、刷写门、无实验室开关、可上传/可刷写
param(
  [string]$RouterHost = '10.251.0.140'
)
if ($env:ROUTER_HOST) { $RouterHost = $env:ROUTER_HOST }
$ErrorActionPreference = 'Stop'
$pwd = $env:ROUTER_SSH_PASSWORD
if (-not $pwd) { $pwd = $env:ROUTER_ROOT_PASSWORD }
if (-not $pwd) { throw 'Set ROUTER_SSH_PASSWORD' }

$base = "http://${RouterHost}/cgi-bin/mp716"
$login = Invoke-RestMethod -Uri "$base/auth/login" -Method POST `
  -Body (@{ username = 'root'; password = $pwd } | ConvertTo-Json -Compress) -ContentType 'application/json'
$h = @{ Authorization = "Bearer $($login.data.token)" }

$fw = Invoke-RestMethod -Uri "$base/system/firmware" -Headers $h
$d = $fw.data

$sshPolicy = (ssh -o ConnectTimeout=12 "root@$RouterHost" "cat /etc/mp716-upgrade/upgrade-policy 2>/dev/null").Trim()
$sshGate = (ssh "root@$RouterHost" "cat /etc/mp716-upgrade/flash-gate 2>/dev/null").Trim()
$sshPlat = (ssh "root@$RouterHost" "cat /etc/mp716-upgrade/platform 2>/dev/null").Trim()
$allowLab = ssh "root@$RouterHost" "test -e /etc/mp716/allow-flash-upgrade && echo yes || echo no"
if ($allowLab -match 'yes') { throw 'remove /etc/mp716/allow-flash-upgrade on production' }
if ($sshPolicy -ne 'production') { throw "upgrade-policy=$sshPolicy (want production)" }
if ($sshGate -ne 'serial-recovery-verified') { throw "flash-gate=$sshGate" }
if ($sshPlat -ne 'confirmed') { throw "platform=$sshPlat" }
if ($d.flashUpgradeEnabled -ne $true) { throw 'API flashUpgradeEnabled must be true' }
if ($d.validationOnly -eq $true) { throw 'API validationOnly must be false' }
if ($d.canUpgrade -ne $true) { throw 'API canUpgrade must be true' }

Write-Host "OK production runtime policy=$sshPolicy flash=$($d.flashUpgradeEnabled) version=$($d.currentVersion)"
Write-Host 'PRODUCTION_RUNTIME_OK'