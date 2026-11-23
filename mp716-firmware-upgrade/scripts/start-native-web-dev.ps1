<#
.SYNOPSIS
Start the local Vue UI against MP716 native firmware APIs.
.DESCRIPTION
Uses Vite openwrt mode and a same-origin proxy; does not build, deploy or upgrade.
Page actions still call the real router. Closing the dev server restores process env.
#>
[CmdletBinding()]
param(
    [string]$WebRoot = 'D:\goweb\src\openwrt_system',
    [uri]$RouterUrl = 'http://192.168.199.1',
    [ValidateRange(1024, 65535)][int]$Port = 5173
)

$ErrorActionPreference = 'Stop'
if ($RouterUrl.Scheme -notin @('http', 'https') -or $RouterUrl.UserInfo -or
    $RouterUrl.Query -or $RouterUrl.Fragment -or $RouterUrl.AbsolutePath -ne '/') {
    throw 'RouterUrl must be an HTTP(S) origin without credentials, path, query or fragment.'
}
$projectPath = (Resolve-Path -LiteralPath $WebRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $projectPath 'node_modules/vite/bin/vite.js'))) {
    throw 'Run npm ci in the Web project first.'
}
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$settings = @{
    VITE_ROUTER_ADAPTER = 'device'
    VITE_AUTH_BYPASS = '0'
    VITE_API_BASE = '/cgi-bin/mp716'
    VITE_DEV_PROXY_TARGET = $RouterUrl.GetLeftPart([System.UriPartial]::Authority)
    VITE_BASE_PATH = '/'
    VITE_ROUTER_BASE = '/'
}
$previous = @{}
foreach ($name in $settings.Keys) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $settings[$name], 'Process')
}
Push-Location -LiteralPath $projectPath
try {
    Write-Host "Local Web: http://127.0.0.1:$Port/#/"
    Write-Host "Native API proxy: $($settings.VITE_DEV_PROXY_TARGET)/cgi-bin/mp716/"
    Write-Host 'Saving or applying settings operates on the real router. Ctrl+C stops this server.'
    & $npmCommand exec -- vite --mode openwrt --host 127.0.0.1 --port $Port --strictPort
    if ($LASTEXITCODE -ne 0) { throw "Vite exited with code $LASTEXITCODE" }
}
finally {
    Pop-Location
    foreach ($name in $settings.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
    }
}
