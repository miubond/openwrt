# 将 dist-openwrt + 更新的 admin.uc / native-routes 推到 MP716（HTTP+wget，适合无 scp）
param(
  [string]$RouterHost = $(if ($env:ROUTER_HOST) { $env:ROUTER_HOST } else { '192.168.199.1' }),
  [string]$LanBind = $(if ($env:DEPLOY_LAN_IP) { $env:DEPLOY_LAN_IP } else { '' }),
  [int]$HttpPort = $(if ($env:DEPLOY_HTTP_PORT) { [int]$env:DEPLOY_HTTP_PORT } else { 8765 }),
  [string]$WebDist = $(Join-Path $PSScriptRoot '..\web\dist-openwrt'),
  [string]$RamWeb = $(Join-Path $PSScriptRoot '..\integration\ram-web')
)

$ErrorActionPreference = 'Stop'
$plink = 'C:\Program Files\PuTTY\plink.exe'
$hk = $(if ($env:ROUTER_SSH_HOSTKEY) { $env:ROUTER_SSH_HOSTKEY } else { 'SHA256:BFzYnw32f0pKGxoWYF5GFK1+l+764s+JxGUp+yzf3w8' })
$pwd = $env:ROUTER_SSH_PASSWORD
if (-not $pwd) { $pwd = $env:ROUTER_ROOT_PASSWORD }
if (-not $pwd) { throw 'Set $env:ROUTER_SSH_PASSWORD (router root) before running this script.' }
if (-not (Test-Path $plink)) { throw "PuTTY plink not found: $plink" }
if (-not (Test-Path (Join-Path $WebDist 'index.html'))) { throw "Missing $WebDist — run: cd web; npm run build:openwrt" }
foreach ($f in @('admin.uc', 'native-routes.json')) {
  if (-not (Test-Path (Join-Path $RamWeb $f))) { throw "Missing $RamWeb\$f" }
}

if (-not $LanBind) {
  $LanBind = (
    Get-NetIPAddress -AddressFamily IPv4 |
      Where-Object { $_.IPAddress -match '^192\.168\.199\.' } |
      Select-Object -First 1 -ExpandProperty IPAddress
  )
}
if (-not $LanBind) {
  $LanBind = (
    Get-NetIPAddress -AddressFamily IPv4 |
      Where-Object { $_.IPAddress -match '^192\.168\.' -and $_.IPAddress -ne '192.168.199.1' } |
      Select-Object -First 1 -ExpandProperty IPAddress
  )
}
if (-not $LanBind) { throw 'Cannot detect LAN IP; set $env:DEPLOY_LAN_IP' }

$stage = Join-Path $env:TEMP 'mp716-native-deploy'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Path $stage, "$stage\www", "$stage\share" | Out-Null
Copy-Item -Recurse "$WebDist\*" "$stage\www\"
Copy-Item (Join-Path $RamWeb 'admin.uc') "$stage\share\"
Copy-Item (Join-Path $RamWeb 'native-routes.json') "$stage\share\"

$install = @'
#!/bin/sh
set -e
rm -rf /tmp/www /tmp/share
tar xzf /tmp/mp716-native-bundle.tgz -C /tmp
mkdir -p /www/mp716
cp -a /tmp/www/. /www/mp716/
cp -f /tmp/www/index.html /www/index.html
mkdir -p /usr/share/mp716
for f in admin.uc native-routes.json; do
  if [ -f "/usr/share/mp716/$f" ]; then cp -f "/usr/share/mp716/$f" "/usr/share/mp716/$f.bak.$(date +%s)"; fi
  cp -f "/tmp/share/$f" "/usr/share/mp716/$f"
  chmod 644 "/usr/share/mp716/$f"
done
rm -rf /tmp/mp716-api-cache
rm -f /tmp/mp716-native-bundle.tgz
echo DEPLOY_OK
du -sk /www/mp716 /usr/share/mp716/admin.uc
'@
$install -replace "`r`n", "`n" | Set-Content -NoNewline -Encoding Ascii (Join-Path $stage 'install.sh')

$tar = Join-Path $env:TEMP 'mp716-native-bundle.tgz'
Write-Host "==> pack -> $tar"
tar -czf $tar -C $stage .

$conn = Get-NetTCPConnection -LocalPort $HttpPort -State Listen -ErrorAction SilentlyContinue
if ($conn) {
  Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}

Write-Host "==> HTTP $LanBind`:$HttpPort"
$http = Start-Process -WindowStyle Hidden -PassThru python -ArgumentList @(
  '-m', 'http.server', "$HttpPort", '--bind', $LanBind, '--directory', $env:TEMP
)
Start-Sleep -Seconds 2
$url = "http://${LanBind}:${HttpPort}/mp716-native-bundle.tgz"
curl.exe -sfI $url | Select-Object -First 1 | Out-Host

$fetch = (
  "wget -O /tmp/mp716-native-bundle.tgz '$url' && " +
  "tar xzf /tmp/mp716-native-bundle.tgz -C /tmp && " +
  "chmod +x /tmp/install.sh && /bin/sh /tmp/install.sh"
)
Write-Host "==> router $RouterHost"
& $plink -ssh "root@${RouterHost}" -pw $pwd -hostkey $hk -batch $fetch

Stop-Process -Id $http.Id -Force -ErrorAction SilentlyContinue
Remove-Item -Force $tar -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "Open: http://${RouterHost}/"
Write-Host "Verify: GET http://${RouterHost}/cgi-bin/mp716/home/dashboard (after login token)"