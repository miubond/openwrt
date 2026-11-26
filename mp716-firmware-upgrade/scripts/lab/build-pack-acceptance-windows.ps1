# Windows：宿主打包 + 门禁 pytest（不含 OpenWrt 全量编译，全量须 Linux 见 build-openwrt-test.sh）
param(
  [string]$SourceMp716upd = $(Join-Path $env:USERPROFILE 'Desktop\MP716-1.0.11\test.mp716upd'),
  [string]$ArtifactDir = $(Join-Path $env:USERPROFILE "Desktop\MP716-$((Get-Content (Join-Path $PSScriptRoot '..\config\firmware.version') -Raw).Trim())"),
  [string]$WebDist = $(Join-Path (Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent) 'openwrt_system\dist-openwrt'),
  [switch]$SkipWebBuild
)
$ErrorActionPreference = 'Stop'
$Root = Join-Path $PSScriptRoot '..'
Set-Location (Resolve-Path $Root)

$fw = (Get-Content config\firmware.version -Raw).Trim()
$webVer = (Get-Content web\package.json -Raw | ConvertFrom-Json).version

if (-not $SkipWebBuild) {
  if (-not (Test-Path $WebDist)) {
    Write-Host "Missing $WebDist — run: cd openwrt_system; npm run build:openwrt"
    throw 'Web dist missing'
  }
}

python scripts/build_host.py
if (Test-Path build\ci-release\ci-test.priv) { Remove-Item build\ci-release\ci-test.priv -Force }
python scripts/prepare-ci-test-key.py

if (-not (Test-Path build\payload-from-1011.bin)) {
  if (-not (Test-Path $SourceMp716upd)) { throw "Missing source package: $SourceMp716upd" }
  python -c @"
from pathlib import Path
from packer.mp716_fwverify import _read_container
c = _read_container(Path(r'$SourceMp716upd'))
Path('build/payload-from-1011.bin').write_bytes(c['payload'])
print('payload', len(c['payload']))
"@
}
Copy-Item build\payload-from-1011.bin build\payload.bin -Force

python packer/mp716_fwpack.py pack `
  --payload build/payload.bin `
  --private-key build/ci-release/ci-test.priv `
  --out build/ci-release/test.mp716upd `
  --hardware-revision ci-lab `
  --firmware-version $fw `
  --base-firmware 014 `
  --web-ui $webVer `
  --upgrade-engine 1.0.0 `
  --build-time ((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))

python scripts/check-mp716upd-artifact-size.py build/ci-release/test.mp716upd
python scripts/check-production-image-budget.py build/ci-release/test.mp716upd
python packer/mp716_fwverify.py build/ci-release/test.mp716upd `
  --public-key build/ci-release/upgrade.pub `
  --profile config/test-device.profile | Out-Null

python -m pytest tests/integration/test_production_size_budget.py tests/integration/test_firmware_capacity_gate.py tests/packer/test_container.py -q

New-Item -ItemType Directory -Path $ArtifactDir -Force | Out-Null
Copy-Item build\ci-release\test.mp716upd, build\ci-release\upgrade.pub -Destination $ArtifactDir -Force
$hash = (Get-FileHash (Join-Path $ArtifactDir 'test.mp716upd') -Algorithm SHA256).Hash.ToLower()
Set-Content -Path (Join-Path $ArtifactDir 'test.mp716upd.sha256') -Value "$hash  test.mp716upd" -Encoding ascii -NoNewline

Write-Host "PACK_ACCEPTANCE_OK"
Write-Host "artifact=$ArtifactDir"
Write-Host "NOTE: payload 来自上一版 squashfs；运行版本变为 $fw 须 Linux:"
Write-Host "  bash scripts/build-openwrt-test.sh --lan-candidate `$WEB_DIST `$OPENWRT_TREE config/test-device.profile `$OUTPUT"