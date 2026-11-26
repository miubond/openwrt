# Deploy dist-openwrt to MP716 via OpenSSH (no param block; use env ROUTER_HOST).
$ErrorActionPreference = 'Stop'
$RouterHost = if ($env:ROUTER_HOST) { $env:ROUTER_HOST } else { '10.251.0.140' }
$srcRoot = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
$WebDist = if ($env:WEB_DIST) { $env:WEB_DIST } else { Join-Path $srcRoot 'openwrt_system\dist-openwrt' }
$WebDist = (Resolve-Path $WebDist).Path
if (-not (Test-Path (Join-Path $WebDist 'index.html'))) { throw "Missing dist: $WebDist (npm run build:openwrt)" }

$stage = Join-Path $env:TEMP 'mp716-www-only'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item -Recurse "$WebDist\*" $stage
Set-Content -Path (Join-Path $stage 'WEB_VERSION.txt') -Value '0.2.3' -Encoding ascii -NoNewline

$tar = Join-Path $env:TEMP 'mp716-www-only.tgz'
if (Test-Path $tar) { Remove-Item -Force $tar }
& tar -czf $tar -C $stage .
if (-not (Test-Path $tar)) { throw "tar failed: $tar" }

$remote = @'
set -e
rm -rf /tmp/mp716-www-only /tmp/www
mkdir -p /tmp/mp716-www-only /tmp/www
cat > /tmp/mp716-www-only.tgz
tar xzf /tmp/mp716-www-only.tgz -C /tmp/www
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
rm -rf /tmp/mp716-api-cache /tmp/www /tmp/mp716-www-only /tmp/mp716-www-only.tgz
sh /usr/share/mp716/mp716-ucode-compile.sh 2>/dev/null || true
echo LAB_WWW_DEPLOY_OK
du -sk /www/mp716/assets 2>/dev/null | head -1
'@

cmd /c "type `"$tar`"" | ssh -o ConnectTimeout=30 "root@${RouterHost}" $remote
Write-Host "Deployed www to $RouterHost"