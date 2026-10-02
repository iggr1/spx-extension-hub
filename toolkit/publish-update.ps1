param([string]$Message='')
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'build-update.ps1')
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'extension\manifest.json') -Raw | ConvertFrom-Json
$version = [string]$manifest.version
if ([string]::IsNullOrWhiteSpace($Message)) { $Message = "SPX Toolkit v$version" }
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repoRoot
try {
  git add toolkit
  git commit -m $Message
  git push origin main
} finally { Pop-Location }
