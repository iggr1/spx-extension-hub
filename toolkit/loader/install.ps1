param([string]$InstallRoot = "$env:LOCALAPPDATA\SPXToolkit")

$ErrorActionPreference = 'Stop'
$NativeHostName = 'com.spx.toolkit.updater'
$Repository = 'iggr1/spx-extension-hub'
$Branch = 'main'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ToolkitRoot = Split-Path -Parent $ScriptDir
$SourceExtension = Join-Path $ToolkitRoot 'extension'
$ExtensionIdFile = Join-Path $ScriptDir 'extension-id.txt'
$UpdaterSource = Join-Path $ScriptDir 'SPXToolkitUpdater.cs'
$NativeDir = Join-Path $InstallRoot 'native'
$ExtensionDir = Join-Path $InstallRoot 'extension'
$UpdaterExe = Join-Path $NativeDir 'SPXToolkitUpdater.exe'
$ConfigPath = Join-Path $NativeDir 'config.json'
$HostManifestPath = Join-Path $NativeDir "$NativeHostName.json"

function Copy-FolderClean {
  param([string]$Source,[string]$Destination)
  if (-not (Test-Path $Source)) { throw "Pasta não encontrada: $Source" }
  if (Test-Path $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
}

if (-not (Test-Path $ExtensionIdFile)) { throw "extension-id.txt não encontrado em $ScriptDir" }
if (-not (Test-Path (Join-Path $SourceExtension 'manifest.json'))) { throw "manifest.json não encontrado em $SourceExtension" }

$ExtensionId = (Get-Content -LiteralPath $ExtensionIdFile -Raw).Trim()
if ($ExtensionId -notmatch '^[a-p]{32}$') { throw "ID de extensão inválido: $ExtensionId" }

Write-Host ''
Write-Host 'SPX Toolkit Loader' -ForegroundColor DarkYellow
Write-Host 'Instalando extensão e atualização automática...' -ForegroundColor Gray
Write-Host ''

New-Item -ItemType Directory -Force -Path $InstallRoot,$NativeDir | Out-Null
Copy-FolderClean -Source $SourceExtension -Destination $ExtensionDir

$config = [ordered]@{
  repository = $Repository
  branch = $Branch
  extensionPath = $ExtensionDir
  updatePath = 'toolkit/update.json'
  packageManifestPath = 'toolkit/update-package/package.json'
}
$config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8

if (Test-Path $UpdaterExe) { Remove-Item -LiteralPath $UpdaterExe -Force }
$sourceCode = $null
if (Test-Path $UpdaterSource) {
  $sourceCode = Get-Content -LiteralPath $UpdaterSource -Raw
} else {
  $sourceParts = Get-ChildItem -LiteralPath $ScriptDir -Filter 'SPXToolkitUpdater.part-*.txt' | Sort-Object Name
  if ($sourceParts.Count -eq 0) { throw 'Código-fonte do SPX Toolkit Loader não encontrado.' }
  $sourceCode = ($sourceParts | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join ''
}
Add-Type `
  -TypeDefinition $sourceCode `
  -Language CSharp `
  -ReferencedAssemblies @('System.dll','System.Core.dll','System.Web.Extensions.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll','System.Security.dll') `
  -OutputAssembly $UpdaterExe `
  -OutputType ConsoleApplication

$hostManifest = [ordered]@{
  name = $NativeHostName
  description = 'SPX Toolkit Loader - atualizador local'
  path = $UpdaterExe
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$hostManifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $HostManifestPath -Encoding UTF8

$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$NativeHostName"
New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $HostManifestPath

Write-Host 'Instalação concluída.' -ForegroundColor Green
Write-Host "ID fixo: $ExtensionId" -ForegroundColor Gray
Write-Host "Pasta: $ExtensionDir" -ForegroundColor Gray
Write-Host ''
Write-Host 'No Chrome:' -ForegroundColor Cyan
Write-Host '1. Abra chrome://extensions/'
Write-Host '2. Ative Modo do desenvolvedor'
Write-Host '3. Clique em Carregar sem compactação'
Write-Host "4. Selecione: $ExtensionDir"
Write-Host ''
Write-Host 'Depois disso o SPX Toolkit verifica o GitHub a cada 10 minutos.' -ForegroundColor Green

try { Set-Clipboard -Value $ExtensionDir } catch { }

$chromeCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path $_) }
if ($chromeCandidates.Count -gt 0) { Start-Process -FilePath $chromeCandidates[0] -ArgumentList 'chrome://extensions/' }
Start-Process explorer.exe -ArgumentList $ExtensionDir
