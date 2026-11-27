@echo off
chcp 65001 >nul
title TajirPro POS & Store Server
cd /d "%~dp0"

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Node.js is not installed on this machine.
  echo Download Node.js 22 LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

node scripts/auto-start.mjs
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Server stopped with an error.
  pause
)
