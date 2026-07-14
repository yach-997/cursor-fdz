# Stop Node dev servers (ports 3000 / 5173 / 5175). Docker stays up by default.
param(
    [switch]$Docker
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path $PSScriptRoot -Parent

Write-Host ''
Write-Host 'Stopping dev services...' -ForegroundColor Yellow

foreach ($port in @(3000, 5173, 5175)) {
    $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        $procId = $c.OwningProcess
        if ($procId -and $procId -ne 0) {
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            Write-Host "  Freed port $port (PID $procId)" -ForegroundColor Green
        }
    }
}

Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
        $_.CommandLine -match 'cursor-fdz\\backend|cursor-fdz\\frontend-pc|cursor-fdz\\frontend-h5|nest start|vite'
    } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "  Stopped node PID $($_.ProcessId)" -ForegroundColor Green
    }

if ($Docker) {
    Push-Location $Root
    docker compose stop postgres redis minio
    Pop-Location
    Write-Host '  Docker containers stopped' -ForegroundColor Green
}

Write-Host ''
Write-Host 'Dev services stopped.' -ForegroundColor Cyan
Write-Host 'Docker DB stays running (use -Docker to stop containers).' -ForegroundColor Gray
Write-Host ''
