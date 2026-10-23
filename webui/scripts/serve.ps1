# Start the FEA web UI on http://localhost:8000 (set $env:PORT to change).
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$port = if ($env:PORT) { $env:PORT } else { '8000' }
$python = if (Get-Command python -ErrorAction SilentlyContinue) { 'python' } else { 'py' }
Write-Host "Open http://localhost:$port in your browser (Ctrl+C to stop)."
& $python -m uvicorn backend.server:app --host 127.0.0.1 --port $port
