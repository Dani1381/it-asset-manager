@echo off
title "IT Asset Master Web Server"
cd /d "%~dp0"

echo ====================================================
echo        Starting IT Asset Master Web Server
echo ====================================================
echo.

node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b
)

echo Starting server on port 3000...
node server.js
pause
