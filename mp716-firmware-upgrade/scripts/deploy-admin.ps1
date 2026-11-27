# 生产管理面部署：Vue dist-openwrt + 正式升级 ucode 栈（不含实验室开关）
param(
  [string]$RouterHost = '10.251.0.140',
  [string]$RamWeb = '',
  [string]$WebDist = '',
  [string]$ReleasePubPath = '',
  [switch]$SkipWeb,
  [switch]$KeepLaboratoryPolicy
)
$ErrorActionPreference = 'Stop'
if ($env:ROUTER_HOST) { $RouterHost = $env:ROUTER_HOST }
if (-not $RamWeb) { $RamWeb = (Resolve-Path (Join-Path $PSScriptRoot '..\integration\ram-web')).Path }
if (-not $WebDist) {
  $srcRoot = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
  $WebDist = Join-Path $srcRoot 'openwrt_system\dist-openwrt'
}
if (-not $SkipWeb) {
  $WebDist = (Resolve-Path $WebDist).Path
  if (-not (Test-Path (Join-Path $WebDist 'index.html'))) {
    throw "Missing $WebDist — run: cd openwrt_system; npm run build:openwrt"
  }
}

$PushRaw = Join-Path $PSScriptRoot 'ssh-push-raw.py'
function Push-RawFile {
  param([string]$LocalPath, [string]$RemotePath, [string]$Mode = '644', [switch]$Text, [int]$ExpectSize = 0)
  $pyArgs = @($PushRaw, $RouterHost, $LocalPath, $RemotePath, '--mode', $Mode)
  if ($Text) { $pyArgs += '--text' }
  if ($ExpectSize) { $pyArgs += @('--expect-size', $ExpectSize) }
  & python @pyArgs
  if ($LASTEXITCODE -ne 0) { throw "ssh push failed: $RemotePath" }
}

$files = @(
  'httpd.uc', 'build-meta.uc', 'capabilities.uc', 'dispatch.uc', 'native-routes.json',
  'firmware-job.uc', 'firmware-boot-confirm.uc', 'upgrade-policy.uc',
  'mp716-open-production-gate.sh'
)
foreach ($f in $files) {
  $p = Join-Path $RamWeb $f
  if (-not (Test-Path $p)) { throw "Missing $p" }
}
foreach ($f in $files) {
  $mode = if ($f -match '\.sh$') { '755' } else { '644' }
  Push-RawFile -LocalPath (Join-Path $RamWeb $f) -RemotePath "/usr/share/mp716/$f" -Mode $mode -Text
}

$sysupLocal = Join-Path $RamWeb '..\openwrt-package\files\usr\sbin\mp716-sysupgrade'
if (Test-Path $sysupLocal) {
  Push-RawFile -LocalPath (Resolve-Path $sysupLocal).Path -RemotePath '/usr/sbin/mp716-sysupgrade' -Mode '755' -Text
}

$policyRemote = if ($KeepLaboratoryPolicy) {
  @'
mkdir -p /etc/mp716-upgrade
[ -f /etc/mp716-upgrade/upgrade-policy ] || echo laboratory > /etc/mp716-upgrade/upgrade-policy
'@
} else {
  @'
mkdir -p /etc/mp716-upgrade
echo production > /etc/mp716-upgrade/upgrade-policy
echo serial-recovery-verified > /etc/mp716-upgrade/flash-gate
echo confirmed > /etc/mp716-upgrade/platform
chmod 644 /etc/mp716-upgrade/upgrade-policy /etc/mp716-upgrade/flash-gate /etc/mp716-upgrade/platform
rm -f /etc/mp716/allow-flash-upgrade
for p in /etc/mp716-upgrade/flash-gate /etc/mp716-upgrade/platform /etc/mp716-upgrade/upgrade-policy; do
  grep -qxF "$p" /lib/upgrade/keep.d/mp716-admin 2>/dev/null || echo "$p" >> /lib/upgrade/keep.d/mp716-admin
done
'@
}
ssh "root@$RouterHost" $policyRemote

$portMapsDir = Join-Path $RamWeb 'port-maps'
$lanMacRaw = (ssh -o ConnectTimeout=12 "root@$RouterHost" "jsonfilter -e '@.network.lan.macaddr' /etc/board.json 2>/dev/null" 2>$null)
$lanMac = if ($lanMacRaw) { $lanMacRaw.Trim().ToLower() } else { '' }
if ($lanMac -match '^([0-9a-f]{2}:){5}[0-9a-f]{2}$') {
  $mapFile = Join-Path $portMapsDir ($lanMac.Replace(':', '') + '.json')
  if (Test-Path $mapFile) {
    ssh "root@$RouterHost" 'mkdir -p /etc/mp716-admin'
    Push-RawFile -LocalPath (Resolve-Path $mapFile).Path -RemotePath '/etc/mp716-admin/port-map.json' -Mode '600' -Text
    Write-Host "Installed port-map for $lanMac"
  }
} elseif (-not $lanMac) {
  Write-Warning "Skipping port-map install: could not read LAN MAC from $RouterHost"
}

if ($ReleasePubPath -and (Test-Path $ReleasePubPath)) {
  Push-RawFile -LocalPath (Resolve-Path $ReleasePubPath).Path -RemotePath '/etc/mp716-upgrade/upgrade.pub' -ExpectSize 32
}

if (-not $SkipWeb) {
  $stage = Join-Path $env:TEMP 'mp716-www-deploy'
  if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
  New-Item -ItemType Directory -Path $stage | Out-Null
  Copy-Item -Recurse "$WebDist\*" $stage
  $webPkg = Join-Path (Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent) 'openwrt_system\package.json'
  $webVer = if (Test-Path $webPkg) { (Get-Content $webPkg -Raw | ConvertFrom-Json).version } else { '' }
  if ($webVer) {
    Set-Content -Path (Join-Path $stage 'WEB_VERSION.txt') -Value $webVer -Encoding ascii -NoNewline
  }
  $tar = Join-Path $env:TEMP 'mp716-www-deploy.tgz'
  if (Test-Path $tar) { Remove-Item -Force $tar }
  & tar -czf $tar -C $stage .
  Push-RawFile -LocalPath $tar -RemotePath '/tmp/mp716-www.tgz' -Mode '600'
  ssh "root@$RouterHost" @'
set -e
rm -rf /tmp/www
mkdir -p /tmp/www
tar xzf /tmp/mp716-www.tgz -C /tmp/www
if [ -d /tmp/www/assets ]; then
  rm -rf /www/mp716/assets.staging
  mkdir -p /www/mp716/assets.staging
  cp -a /tmp/www/assets/. /www/mp716/assets.staging/
  rm -rf /www/mp716/assets
  mv /www/mp716/assets.staging /www/mp716/assets
fi
cp -a /tmp/www/. /www/mp716/
cp -f /tmp/www/index.html /www/index.html
cp -f /tmp/www/index.html /www/mp716/index.html
[ -f /tmp/www/WEB_VERSION.txt ] && cp -f /tmp/www/WEB_VERSION.txt /etc/mp716-web.version
rm -rf /tmp/mp716-api-cache /tmp/www /tmp/mp716-www.tgz
sh /usr/share/mp716/mp716-ucode-compile.sh 2>/dev/null || true
'@
}

ssh "root@$RouterHost" 'rm -rf /tmp/mp716-api-cache; echo DEPLOY_ADMIN_OK'
Write-Host "Deployed admin + upgrade stack to $RouterHost (policy=production unless -KeepLaboratoryPolicy)"