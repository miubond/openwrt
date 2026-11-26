# 推送完整 Web 刷写栈到 MP716（httpd + upgrade-policy + firmware-job + routes）
param(
  [string]$RouterHost = '10.251.0.140',
  [string]$RamWeb = ''
)
if ($env:ROUTER_HOST) { $RouterHost = $env:ROUTER_HOST }
if (-not $RamWeb) { $RamWeb = Join-Path $PSScriptRoot '..\integration\ram-web' }
$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
function Push-Utf8NoBomFile {
  param([string]$LocalPath, [string]$RemotePath, [string]$SshHost)
  $bytes = $Utf8NoBom.GetBytes([IO.File]::ReadAllText($LocalPath))
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'ssh'
  $psi.Arguments = "-o ConnectTimeout=15 root@${SshHost} sh -c `"cat > $RemotePath`""
  $psi.RedirectStandardInput = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $proc = [Diagnostics.Process]::Start($psi)
  $proc.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
  $proc.StandardInput.Close()
  if ($proc.WaitForExit(120000) -and $proc.ExitCode -ne 0) { throw "ssh push failed: $RemotePath" }
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
  Push-Utf8NoBomFile -LocalPath (Join-Path $RamWeb $f) -RemotePath "/usr/share/mp716/$f" -SshHost $RouterHost
  if ($f -match '\.sh$') {
    ssh "root@$RouterHost" "chmod 755 /usr/share/mp716/$f"
  } else {
    ssh "root@$RouterHost" "chmod 644 /usr/share/mp716/$f"
  }
}
$sysupLocal = Join-Path $RamWeb '..\openwrt-package\files\usr\sbin\mp716-sysupgrade'
if (Test-Path $sysupLocal) {
  $text = [IO.File]::ReadAllText($sysupLocal) -replace "`r`n", "`n"
  $bytes = (New-Object System.Text.UTF8Encoding $false).GetBytes($text)
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'ssh'
  $psi.Arguments = "-o ConnectTimeout=15 root@${RouterHost} sh -c `"cat > /usr/sbin/mp716-sysupgrade; chmod 755 /usr/sbin/mp716-sysupgrade; sed -i 's/\\r$//' /usr/sbin/mp716-sysupgrade`""
  $psi.RedirectStandardInput = $true
  $psi.UseShellExecute = $false
  $proc = [Diagnostics.Process]::Start($psi)
  $proc.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
  $proc.StandardInput.Close()
  $proc.WaitForExit()
}
ssh "root@$RouterHost" @"
mkdir -p /etc/mp716-upgrade
[ -f /etc/mp716-upgrade/upgrade-policy ] || echo laboratory > /etc/mp716-upgrade/upgrade-policy
grep -q mp716-sysupgrade /etc/init.d/mp716-sysupgrade 2>/dev/null && true || true
rm -rf /tmp/mp716-api-cache
echo DEPLOY_UPGRADE_STACK_OK
"@
Write-Host "Deployed upgrade stack to $RouterHost"