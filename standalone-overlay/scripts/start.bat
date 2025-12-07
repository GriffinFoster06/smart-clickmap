@echo off
REM Smart Clickmap - Standalone Server Startup Script (Windows)
REM Usage: scripts\start.bat

setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set ROOT_DIR=%SCRIPT_DIR%..
set BACKEND_DIR=%ROOT_DIR%\backend
set CONFIG_FILE=%ROOT_DIR%\config\default.json

echo.
echo ==================================================
echo   Smart Clickmap - Standalone Server
echo ==================================================
echo.

REM Check Node.js installation
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo X Error: Node.js is not installed
    echo.
    echo Please install Node.js 18 or higher:
    echo   https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM Check Node.js version (simplified check)
for /f "tokens=1 delims=." %%i in ('node -v') do set NODE_MAJOR=%%i
set NODE_MAJOR=%NODE_MAJOR:v=%
if %NODE_MAJOR% LSS 18 (
    echo X Error: Node.js 18+ required
    echo.
    echo Please upgrade Node.js:
    echo   https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo + Node.js detected
echo.

REM Install dependencies if needed
if not exist "%BACKEND_DIR%\node_modules" (
    echo Installing dependencies...
    cd /d "%BACKEND_DIR%"
    call npm install
    echo.
)

REM Set default port
set PORT=8080

REM Display URLs
echo Starting server on port %PORT%...
echo.
echo Access URLs:
echo    Viewer:  http://localhost:%PORT%/viewer/YOUR_CHANNEL
echo    Admin:   http://localhost:%PORT%/admin
echo    OBS:     http://localhost:%PORT%/obs
echo    Status:  http://localhost:%PORT%/status
echo.
echo Press Ctrl+C to stop the server
echo.
echo ==================================================
echo.

REM Start the server
cd /d "%BACKEND_DIR%"
node server.js

pause
