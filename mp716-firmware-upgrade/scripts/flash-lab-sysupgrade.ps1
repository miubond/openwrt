# Laboratory: flash MP716 sysupgrade.bin via SSH (OpenWrt sysupgrade, keep overlay config).
param(
  [string]$RouterHost = $(if ($env:ROUTER_HOST) { $env:ROUTER_HOST } else { '192.168.1.1' }),
  [Parameter(Mandatory = $true)]
  [string]$ImagePath
)

$ErrorActionPreference = 'Stop'
$plink = 'C:\Program Files\PuTTY\plink.exe'
$hk = $(if ($env:ROUTER_SSH_HOSTKEY) { $env:ROUTER_SSH_HOSTKEY } else { 'SHA256:FwRCl0X+4tzjf1dwNH0H5YEO6wai5jbo2YPblslvwyY' })
$pwd = $env:ROUTER_SSH_PASSWORD
if (-not $pwd) { $pwd = $env:ROUTER_ROOT_PASSWORD }
if (-not $pwd) { throw 'Set $env:ROUTER_SSH_PASSWORD before flash.' }
if (-not (Test-Path $plink)) { throw "PuTTY plink not found: $plink" }
if (-not (Test-Path $ImagePath)) { throw "Missing image: $ImagePath" }

$remote = '/tmp/mp716-sysupgrade-ci.bin'
Write-Host "==> upload $ImagePath -> $RouterHost`:$remote"
& scp -O $ImagePath "root@${RouterHost}:$remote"
Write-Host '==> sysupgrade -T'
& $plink -ssh "root@$RouterHost" -pw $pwd -hostkey $hk -batch "sysupgrade -T $remote"
Write-Host '==> sysupgrade -v (preserve config); device will reboot'
& $plink -ssh "root@$RouterHost" -pw $pwd -hostkey $hk -batch "setsid sysupgrade -v $remote > /tmp/sysupgrade-run.log 2>&1 < /dev/null &"
Write-Host "Wait for ping/SSH on $RouterHost then:"
Write-Host "  ssh root@$RouterHost 'wg show; ls /lib/modules/`$(uname -r)/wireguard.ko*; test -x /usr/bin/wg && echo wg-ok'"