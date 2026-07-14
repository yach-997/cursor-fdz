# Dev launcher for Windows (called by start.bat)
$ErrorActionPreference = 'Continue'
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

function Test-PortListening([int]$Port) {
  try {
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $c
  } catch {
    return $false
  }
}

Write-Host ''
Write-Host '[1/4] Docker: postgres / redis / minio ...' -ForegroundColor Cyan
docker compose up -d postgres redis minio minio-init
if ($LASTEXITCODE -ne 0) {
  Write-Host '  [WARN] Docker failed. Open Docker Desktop, then run start.bat again.' -ForegroundColor Yellow
} else {
  Write-Host '  [OK] Docker services started' -ForegroundColor Green
}

Write-Host '  Waiting 8s for database...'
Start-Sleep -Seconds 8

Write-Host ''
Write-Host '[2/4] Backend API :3000 ...' -ForegroundColor Cyan
if (Test-PortListening 3000) {
  Write-Host '  [SKIP] Port 3000 already in use' -ForegroundColor Yellow
} else {
  Start-Process -FilePath 'cmd.exe' -ArgumentList @(
    '/k',
    "cd /d `"$Root\backend`" && title Backend-API-3000 && npm run start:dev"
  )
  Start-Sleep -Seconds 3
}

Write-Host '[3/4] PC admin :5173 ...' -ForegroundColor Cyan
if (Test-PortListening 5173) {
  Write-Host '  [SKIP] Port 5173 already in use' -ForegroundColor Yellow
} else {
  Start-Process -FilePath 'cmd.exe' -ArgumentList @(
    '/k',
    "cd /d `"$Root\frontend-pc`" && title PC-5173 && npm run dev"
  )
  Start-Sleep -Seconds 2
}

Write-Host '[4/4] H5 inspector :5175 ...' -ForegroundColor Cyan
if (Test-PortListening 5175) {
  Write-Host '  [SKIP] Port 5175 already in use' -ForegroundColor Yellow
} else {
  Start-Process -FilePath 'cmd.exe' -ArgumentList @(
    '/k',
    "cd /d `"$Root\frontend-h5`" && title H5-5175 && npm run dev"
  )
}

Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host '  Launch commands sent. Wait 20-30s.' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor Green
Write-Host ''
Write-Host '  PC:      http://localhost:5173'
Write-Host '  H5:      http://localhost:5175/m'
Write-Host '  API:     http://localhost:3000/api'
Write-Host '  Account: admin / admin123'
Write-Host ''

Write-Host 'Waiting 15s then open PC page...'
Start-Sleep -Seconds 15

# Quick health check
try {
  $null = Invoke-WebRequest -Uri 'http://localhost:3000/api/auth/login' -Method OPTIONS -TimeoutSec 3 -UseBasicParsing
  Write-Host '  Backend seems up.' -ForegroundColor Green
} catch {
  Write-Host '  Backend still starting (open PC page later if blank).' -ForegroundColor Yellow
}

Start-Process 'http://localhost:5173'
exit 0
