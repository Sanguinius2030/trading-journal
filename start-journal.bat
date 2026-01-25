@echo off
title Trading Journal Launcher

cd /d "%~dp0"

echo Starting Trading Journal...
echo.

:: Start API server in a new window
start "Trading Journal API" cmd /k "npm run dev:api"

:: Wait a moment for API to start
timeout /t 2 /nobreak >nul

:: Start Vite dev server in a new window
start "Trading Journal App" cmd /k "npm run dev"

:: Wait for Vite to start
timeout /t 3 /nobreak >nul

:: Open browser
start http://localhost:5173

echo.
echo Trading Journal is running!
echo - API Server: http://localhost:3001
echo - App: http://localhost:5173
echo.
echo Close this window - the servers will keep running.
echo To stop everything, close the two terminal windows.
