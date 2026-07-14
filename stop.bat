@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title Inspection System - Stop
echo.
echo ========================================
echo   Stopping dev services
echo ========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-dev.ps1"

echo.
echo Press any key to close...
pause >nul
endlocal
