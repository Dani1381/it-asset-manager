# Starts the Arka Asset Manager server if it is not already running (used by the "Arka Asset Manager" scheduled task).
# The AI key comes from the DANI_API_KEY user environment variable; nothing secret is stored here.
$ErrorActionPreference = 'SilentlyContinue'
$Port = 3000
$AppDir = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $env:LOCALAPPDATA 'ArkaAssetManager'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$Log = Join-Path $LogDir 'server.log'

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { exit 0 }

# Start-Process overwrites the log, so keep the previous run's logs next to it
foreach ($f in @($Log, "$Log.err")) {
  if (Test-Path $f) { Move-Item $f ($f -replace 'server\.log', 'server.prev.log') -Force }
}

$env:DANI_API_KEY = [Environment]::GetEnvironmentVariable('DANI_API_KEY', 'User')
Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $AppDir -WindowStyle Hidden `
  -RedirectStandardOutput $Log -RedirectStandardError "$Log.err"
