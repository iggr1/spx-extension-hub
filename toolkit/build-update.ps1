param(
  [string]$ToolkitRoot = $PSScriptRoot,
  [ValidateSet('overlay','replace')][string]$Mode = 'replace'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$ExtensionDir = Join-Path $ToolkitRoot 'extension'
$PackageDir = Join-Path $ToolkitRoot 'update-package'
$ManifestPath = Join-Path $ExtensionDir 'manifest.json'
$UpdateJsonPath = Join-Path $ToolkitRoot 'update.json'
$TempRoot = Join-Path ([IO.Path]::GetTempPath()) ("SPXToolkitBuild-" + [guid]::NewGuid().ToString('N'))
$ZipPath = Join-Path $TempRoot 'extension.zip'
if (-not (Test-Path $ManifestPath)) { throw "manifest.json não encontrado em $ExtensionDir" }
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$version = [string]$manifest.version
if ([string]::IsNullOrWhiteSpace($version)) { throw 'Versão inválida no manifest.json.' }
try {
  New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null
  [IO.Compression.ZipFile]::CreateFromDirectory($ExtensionDir,$ZipPath,[IO.Compression.CompressionLevel]::Optimal,$false)
  $bytes = [IO.File]::ReadAllBytes($ZipPath)
  $sha = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace('-','').ToLowerInvariant()
  $base64 = [Convert]::ToBase64String($bytes)
  if (Test-Path $PackageDir) { Remove-Item -LiteralPath $PackageDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $PackageDir | Out-Null
  $chunkSize = 500000
  $parts = @()
  for ($offset=0; $offset -lt $base64.Length; $offset += $chunkSize) {
    $length = [Math]::Min($chunkSize,$base64.Length-$offset)
    $name = 'part-{0:D3}.b64' -f ($parts.Count+1)
    $base64.Substring($offset,$length) | Set-Content -LiteralPath (Join-Path $PackageDir $name) -NoNewline -Encoding ASCII
    $parts += $name
  }
  [ordered]@{version=$version;format='zip-base64-parts-v1';mode=$Mode;sha256=$sha;parts=$parts;delete=@()} |
    ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $PackageDir 'package.json') -Encoding UTF8
  [ordered]@{version=$version;channel='stable';releasedAt=[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ');notes="SPX Toolkit $version"} |
    ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $UpdateJsonPath -Encoding UTF8
  Write-Host "SPX Toolkit $version preparado: $($parts.Count) parte(s), SHA-256 $sha" -ForegroundColor Green
} finally {
  if (Test-Path $TempRoot) { Remove-Item -LiteralPath $TempRoot -Recurse -Force }
}
