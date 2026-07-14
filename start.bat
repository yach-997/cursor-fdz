@echo off
setlocal EnableExtensions
cd /d "%~dp0"

REM ASCII-only launcher. Chinese UTF-8 in .bat breaks cmd.exe (GBK).
title Inspection System - Start
echo.
echo ========================================
echo   Inspection System - Dev Start
echo ========================================
echo   Root: %~dp0
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-dev.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Start failed. See messages above.
  pause
  exit /b 1
)

echo.
echo Press any key to close this window...
echo Keep the Backend / PC / H5 console windows open.
pause >nul
endlocal
