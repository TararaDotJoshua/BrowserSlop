$ErrorActionPreference = "Stop"
$brokerPath = Join-Path $PSScriptRoot "x-broker.js"

try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:8766/health" -TimeoutSec 1
  if ($health.ok) {
    Write-Host "BrowserSlop X broker is already running."
    exit 0
  }
} catch {
  # Start it below.
}

$nodeCommand = Get-Command node -ErrorAction Stop
Start-Process -FilePath $nodeCommand.Source -ArgumentList @("`"$brokerPath`"") -WorkingDirectory $PSScriptRoot -WindowStyle Hidden

for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Milliseconds 150
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8766/health" -TimeoutSec 1
    if ($health.ok) {
      Write-Host "BrowserSlop X broker is running on 127.0.0.1:8766."
      exit 0
    }
  } catch {
    # Keep waiting briefly for Node to start.
  }
}

throw "The BrowserSlop X broker did not start. Run 'node x-broker.js' to see the error."
