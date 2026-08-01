$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$manifest = Get-Content -Raw (Join-Path $repoRoot "manifest.json") | ConvertFrom-Json
$buildPath = Join-Path $repoRoot "dist\BrowserSlop"
$releasePath = Join-Path $repoRoot "release"
$archivePath = Join-Path $releasePath ("BrowserSlop-{0}.zip" -f $manifest.version)

if (-not (Test-Path -LiteralPath $buildPath -PathType Container)) {
  throw "Production build not found: $buildPath"
}
New-Item -ItemType Directory -Path $releasePath -Force | Out-Null
if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
Compress-Archive -Path (Join-Path $buildPath "*") -DestinationPath $archivePath -CompressionLevel Optimal
Write-Host "Packaged $archivePath"
