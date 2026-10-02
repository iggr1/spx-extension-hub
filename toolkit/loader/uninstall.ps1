param([string]$InstallRoot = "$env:LOCALAPPDATA\SPXToolkit")
$ErrorActionPreference = 'Stop'
$NativeHostName = 'com.spx.toolkit.updater'
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$NativeHostName"
if (Test-Path $registryPath) { Remove-Item -LiteralPath $registryPath -Recurse -Force }
if (Test-Path $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
Write-Host 'SPX Toolkit Loader removido.' -ForegroundColor Green
Write-Host 'Se necessário, remova a extensão também em chrome://extensions/.' -ForegroundColor Yellow
