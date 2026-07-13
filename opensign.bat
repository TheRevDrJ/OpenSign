@echo off
:: OpenSign - local-first kiosk / digital-signage for churches and nonprofits
:: Copyright (c) 2026 TheRevDrJ
:: Licensed under AGPL-3.0 - see LICENSE file for details
setlocal enabledelayedexpansion

:: ============================================================================
:: OpenSign Server Manager (Windows) - mirrors opensign.sh
::
:: One server, one port: the FastAPI backend on :6101 serves BOTH the built
:: frontend (frontend\dist) AND the API - the same artifact in development and
:: on the kiosk. No separate dev server, no hot-reload socket.
::
::   opensign start     build the frontend, then serve it + the API on :6101
::   opensign stop      stop the server
::   opensign build     rebuild the frontend (after changing frontend code)
::   opensign watch     serve + auto-rebuild on save (dev loop; refresh page)
::   opensign status    is it running
::   opensign restart   stop, then start
::   opensign log       follow the log
::
:: Point the kiosk display at  http://<this-PC-IP>:6101/ .
::
:: SAFETY (process-kills are destructive - kill NARROW, never broad): the kill
:: targets ONLY the PID LISTENING on the hard-coded port 6101 via :find_pid, or
:: the narrow command-line match in kill_opensign.ps1. No broad/wildcard match
:: exists, so an empty target is a no-op, never a fall-through to killing all.
:: ============================================================================

set "SCRIPT_DIR=%~dp0"
set "PORT=6101"
set "BACKEND_LOG=%SCRIPT_DIR%backend.log"
set "FRONTEND_DIR=%SCRIPT_DIR%frontend"
set "VENV_PYTHONW=%SCRIPT_DIR%backend\.venv\Scripts\pythonw.exe"
set "KILL_HELPER=%SCRIPT_DIR%kill_opensign.ps1"

set "CMD=%~1"

if /i "%CMD%"=="start"   goto do_start
if /i "%CMD%"=="stop"    goto do_stop
if /i "%CMD%"=="restart" goto do_restart
if /i "%CMD%"=="build"   goto do_build
if /i "%CMD%"=="watch"   goto do_watch
if /i "%CMD%"=="status"  goto do_status
if /i "%CMD%"=="log"     goto do_log
if /i "%CMD%"=="help"    goto help
if /i "%CMD%"=="--help"  goto help
if /i "%CMD%"=="-h"      goto help
goto help

:: ============================================================================
:do_start
if not exist "%VENV_PYTHONW%" (
    echo   ERROR: backend venv not found at %VENV_PYTHONW%
    echo   Set it up first ^(see README^): python -m venv backend\.venv
    exit /b 1
)
call :do_build
if errorlevel 1 (
    echo   [X] build failed - leaving any running server untouched.
    exit /b 1
)
call :find_pid %PORT%
if defined RUNNING_PID (
    echo   Server already running on %PORT% ^(PID: !RUNNING_PID!^) - serving the fresh build.
) else (
    echo   Starting server ^(uvicorn^) on %PORT%...
    start "" /b "%VENV_PYTHONW%" -m uvicorn app.main:app --host 0.0.0.0 --port %PORT% --app-dir backend > "%BACKEND_LOG%" 2>&1
    call :wait_port
)
echo.
echo   OpenSign is running on %PORT% ^(built app + API, one server^).
echo     Local:  http://localhost:%PORT%/   ^(admin: /admin^)
echo     LAN  :  point the kiosk display at  http://^<this-PC-IP^>:%PORT%/
echo.
echo   Changed frontend code? Re-run 'opensign build' ^(or use 'watch'^).
exit /b 0

:: ============================================================================
:do_stop
call :kill_port %PORT% "server"
if errorlevel 1 ( echo   Nothing running on %PORT%. ) else ( echo   Stopped. )
:: narrow stale-backend cleanup (pythonw running THIS project's uvicorn, by
:: command line only - kills nothing if there is no match)
powershell -NoProfile -ExecutionPolicy Bypass -File "%KILL_HELPER%" >nul 2>&1
exit /b 0

:: ============================================================================
:do_restart
call :do_stop
timeout /t 2 /nobreak >nul
goto do_start

:: ============================================================================
:do_build
echo   Building the frontend ^(npm run build^)...
pushd "%FRONTEND_DIR%"
call npm run build
set "BUILD_RC=!ERRORLEVEL!"
popd
if not "!BUILD_RC!"=="0" exit /b 1
echo   [OK] Built to frontend\dist\
exit /b 0

:: ============================================================================
:do_watch
call :do_build
if errorlevel 1 exit /b 1
call :find_pid %PORT%
if not defined RUNNING_PID (
    echo   Starting server ^(uvicorn^) on %PORT%...
    start "" /b "%VENV_PYTHONW%" -m uvicorn app.main:app --host 0.0.0.0 --port %PORT% --app-dir backend > "%BACKEND_LOG%" 2>&1
    call :wait_port
)
echo.
echo   Watching frontend - edits auto-rebuild. Refresh:  http://localhost:%PORT%/
echo   Press Ctrl+C to stop watching ^(the server keeps running^).
echo   ================================================
pushd "%FRONTEND_DIR%"
call npx vite build --watch
popd
exit /b 0

:: ============================================================================
:do_status
call :find_pid %PORT%
echo.
echo   OpenSign
echo   ========
if defined RUNNING_PID ( echo   server :%PORT%   RUNNING ^(PID: !RUNNING_PID!^) ) else ( echo   server :%PORT%   stopped )
if defined RUNNING_PID echo     Local:  http://localhost:%PORT%/   ^(kiosk: http://^<this-PC-IP^>:%PORT%/^)
echo.
exit /b 0

:: ============================================================================
:do_log
if not exist "%BACKEND_LOG%" (
    echo   No log yet. Start the server first ^(opensign start^).
    exit /b 1
)
echo   Following backend.log. Press Ctrl+C to stop.
echo   ================================================
powershell -NoProfile -Command "Get-Content -Path '%BACKEND_LOG%' -Tail 20 -Wait"
exit /b 0

:: ============================================================================
:wait_port
set /a WP=0
:wp_loop
call :find_pid %PORT%
if defined RUNNING_PID exit /b 0
ping 127.0.0.1 -n 2 >nul
set /a WP+=1
if !WP! geq 30 exit /b 1
goto wp_loop

:: ============================================================================
:kill_port
:: %1 = port (hard-coded literal), %2 = label. Kills ONLY the PID LISTENING on
:: that exact port. Not found / blank = no-op (exit /b 1), never a broad match.
call :find_pid %~1
if defined RUNNING_PID (
    echo   Stopping %~2 on %~1 ^(PID: !RUNNING_PID!^)...
    taskkill /F /T /PID !RUNNING_PID! >nul 2>&1
    exit /b 0
)
exit /b 1

:: ============================================================================
:find_pid
:: %1 = port (hard-coded literal). Sets RUNNING_PID to the PID LISTENING on that
:: exact port, or clears it. needle is ":<port> " with trailing space; the port
:: is always a literal from this script, never user input.
set "RUNNING_PID="
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr "LISTENING" ^| findstr ":%~1 "') do (
    set "RUNNING_PID=%%a"
)
exit /b 0

:: ============================================================================
:help
echo.
echo   OpenSign - server manager ^(Windows^)
echo   ===================================
echo.
echo   One server on :%PORT% serves the built frontend AND the API - the same in
echo   development and on the kiosk. No dev server, no hot-reload socket.
echo.
echo     opensign start     build, then serve the app + API on :%PORT%
echo     opensign stop      stop the server
echo     opensign build     rebuild the frontend ^(after changing frontend code^)
echo     opensign watch     serve + auto-rebuild on save ^(refresh to see changes^)
echo     opensign status    is it running
echo     opensign restart   stop, then start
echo     opensign log       follow the log
echo.
echo   Point a display at  http://^<this-PC-IP^>:%PORT%/ .
echo.
exit /b 0
