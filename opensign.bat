@echo off
:: OpenSign - local-first kiosk / digital-signage for churches and nonprofits
:: Copyright (c) 2026 TheRevDrJ
:: Licensed under AGPL-3.0 - see LICENSE file for details
setlocal enabledelayedexpansion

:: ============================================================================
:: OpenSign Server Manager (Windows) - mirrors opensign.sh
::
:: Usage: opensign <command> [dev^|prod]
::   start dev ^| start prod ^| stop dev ^| stop prod ^| status ^| build
::   restart dev^|prod ^| log ^| help
::
::   DEV  = Vite hot-reload frontend :6100 + FastAPI backend :6101 (development)
::   PROD = the BUILT frontend served with the API from the backend alone on
::          :6101 (no Vite, no hot-reload socket) - what a kiosk should run.
::
::   The backend :6101 is SHARED (dev API + prod app), so 'stop dev' stops only
::   Vite and 'stop prod' stops the backend.
::
:: SAFETY (process-kills are destructive - kill NARROW, never broad): every kill
:: targets a SPECIFIC hard-coded port's PID (6100/6101, never blank) via
:: :find_pid, or the narrow command-line match in kill_opensign.ps1. No broad or
:: wildcard match exists, so an empty target is a no-op, never a fall-through to
:: killing everything.
:: ============================================================================

set "SCRIPT_DIR=%~dp0"
set "FRONTEND_PORT=6100"
set "BACKEND_PORT=6101"
set "BACKEND_LOG=%SCRIPT_DIR%backend.log"
set "FRONTEND_LOG=%SCRIPT_DIR%frontend.log"
set "FRONTEND_DIR=%SCRIPT_DIR%frontend"
set "VENV_PYTHONW=%SCRIPT_DIR%backend\.venv\Scripts\pythonw.exe"
set "FRONTEND_VBS=%SCRIPT_DIR%start_frontend_hidden.vbs"
set "KILL_HELPER=%SCRIPT_DIR%kill_opensign.ps1"

set "CMD=%~1"
set "TARGET=%~2"

if /i "%CMD%"=="start"   goto route_start
if /i "%CMD%"=="stop"    goto route_stop
if /i "%CMD%"=="restart" goto route_restart
if /i "%CMD%"=="status"  goto do_status
if /i "%CMD%"=="build"   goto do_build
if /i "%CMD%"=="log"     goto do_log
if /i "%CMD%"=="help"    goto help
if /i "%CMD%"=="--help"  goto help
if /i "%CMD%"=="-h"      goto help
goto help

:: ============================================================================
:route_start
if /i "%TARGET%"=="dev"  goto start_dev
if /i "%TARGET%"=="prod" goto start_prod
goto help

:route_stop
if /i "%TARGET%"=="dev"  goto stop_dev
if /i "%TARGET%"=="prod" goto stop_prod
call :do_status
goto help

:route_restart
if /i "%TARGET%"=="dev"  goto restart_dev
if /i "%TARGET%"=="prod" goto restart_prod
echo   Usage: opensign restart dev ^| opensign restart prod
exit /b 1

:restart_dev
call :stop_dev
timeout /t 2 /nobreak >nul
goto start_dev

:restart_prod
call :stop_prod
timeout /t 2 /nobreak >nul
goto start_prod

:: ============================================================================
:start_dev
if not exist "%VENV_PYTHONW%" (
    echo   ERROR: backend venv not found at %VENV_PYTHONW%
    echo   Set it up first ^(see README^): python -m venv backend\.venv
    exit /b 1
)
call :find_pid %BACKEND_PORT%
if defined RUNNING_PID (
    echo   Backend already running on %BACKEND_PORT% ^(PID: !RUNNING_PID!^).
) else (
    echo   Starting backend ^(uvicorn^) on %BACKEND_PORT%...
    start "" /b "%VENV_PYTHONW%" -m uvicorn app.main:app --host 0.0.0.0 --port %BACKEND_PORT% --app-dir backend > "%BACKEND_LOG%" 2>&1
)
call :find_pid %FRONTEND_PORT%
if defined RUNNING_PID (
    echo   Vite dev server already running on %FRONTEND_PORT% ^(PID: !RUNNING_PID!^).
) else (
    echo   Starting frontend ^(Vite^) on %FRONTEND_PORT%...
    wscript "%FRONTEND_VBS%"
)
call :wait_both
echo.
echo   DEV is up ^(Vite hot-reload^).
echo     Kiosk:  http://localhost:%FRONTEND_PORT%/
echo     Admin:  http://localhost:%FRONTEND_PORT%/admin
echo.
echo   For a real display, run PROD instead:  opensign start prod
exit /b 0

:: ============================================================================
:start_prod
if not exist "%VENV_PYTHONW%" (
    echo   ERROR: backend venv not found at %VENV_PYTHONW%
    echo   Set it up first ^(see README^).
    exit /b 1
)
call :do_build
if errorlevel 1 (
    echo   [X] build failed - leaving any running server untouched.
    exit /b 1
)
:: (Re)start the backend so it mounts the freshly built dist\.
call :kill_port %BACKEND_PORT% "backend"
echo   Starting backend ^(uvicorn, serving the built app^) on %BACKEND_PORT%...
start "" /b "%VENV_PYTHONW%" -m uvicorn app.main:app --host 0.0.0.0 --port %BACKEND_PORT% --app-dir backend > "%BACKEND_LOG%" 2>&1
call :wait_backend
echo.
echo   PROD is up - built app + API from the backend alone on %BACKEND_PORT% ^(no Vite, no HMR^).
echo     Local:  http://localhost:%BACKEND_PORT%/   ^(admin: /admin^)
echo     LAN  :  point the kiosk display at  http://^<this-PC-IP^>:%BACKEND_PORT%/
echo.
echo   Re-run 'opensign start prod' after frontend changes to rebuild + refresh.
exit /b 0

:: ============================================================================
:stop_dev
call :kill_port %FRONTEND_PORT% "dev server (Vite)"
if errorlevel 1 ( echo   Dev server ^(Vite %FRONTEND_PORT%^) is not running. ) else ( echo   Dev server stopped. )
call :find_pid %BACKEND_PORT%
if defined RUNNING_PID echo   ^(Backend %BACKEND_PORT% left up - it also serves PROD/the kiosk. 'stop prod' stops it.^)
exit /b 0

:: ============================================================================
:stop_prod
call :kill_port %BACKEND_PORT% "backend (prod)"
set "STOPPED_BACK=!ERRORLEVEL!"
:: narrow stale-backend cleanup (pythonw running THIS project's uvicorn, by
:: command line only - kills nothing if there is no match)
powershell -NoProfile -ExecutionPolicy Bypass -File "%KILL_HELPER%" >nul 2>&1
if "!STOPPED_BACK!"=="0" ( echo   Prod backend stopped. ) else ( echo   Backend ^(%BACKEND_PORT%^) was not running. )
call :find_pid %FRONTEND_PORT%
if defined RUNNING_PID echo   ^(Dev server %FRONTEND_PORT% still running. 'stop dev' stops it.^)
exit /b 0

:: ============================================================================
:do_build
echo   Building the production frontend ^(npm run build^)...
pushd "%FRONTEND_DIR%"
call npm run build
set "BUILD_RC=!ERRORLEVEL!"
popd
if not "!BUILD_RC!"=="0" exit /b 1
echo   [OK] Built to frontend\dist\
exit /b 0

:: ============================================================================
:do_status
call :find_pid %FRONTEND_PORT%
set "VITE_PID=!RUNNING_PID!"
call :find_pid %BACKEND_PORT%
set "BACK_PID=!RUNNING_PID!"
echo.
echo   OpenSign
echo   ========
if defined VITE_PID ( echo   DEV  frontend ^(Vite^) :%FRONTEND_PORT%   RUNNING ^(PID: !VITE_PID!^) ) else ( echo   DEV  frontend ^(Vite^) :%FRONTEND_PORT%   stopped )
if defined BACK_PID ( echo   backend / API        :%BACKEND_PORT%   RUNNING ^(PID: !BACK_PID!^) ) else ( echo   backend / API        :%BACKEND_PORT%   stopped )
echo.
if defined VITE_PID echo     Dev  view:  http://localhost:%FRONTEND_PORT%/
if defined BACK_PID echo     Prod view:  http://localhost:%BACKEND_PORT%/   ^(kiosk: http://^<this-PC-IP^>:%BACKEND_PORT%/^)
echo.
exit /b 0

:: ============================================================================
:do_log
if not exist "%BACKEND_LOG%" if not exist "%FRONTEND_LOG%" (
    echo   No logs yet. Start a server first ^(opensign start dev^).
    exit /b 1
)
echo   Following backend.log + frontend.log. Press Ctrl+C to stop.
echo   ================================================
powershell -NoProfile -Command "Get-Content -Path '%BACKEND_LOG%','%FRONTEND_LOG%' -Tail 20 -Wait"
exit /b 0

:: ============================================================================
:wait_backend
set /a WB=0
:wb_loop
call :find_pid %BACKEND_PORT%
if defined RUNNING_PID exit /b 0
ping 127.0.0.1 -n 2 >nul
set /a WB+=1
if !WB! geq 30 exit /b 1
goto wb_loop

:: ============================================================================
:wait_both
set /a WBT=0
:wbt_loop
set "B_UP="
set "F_UP="
call :find_pid %BACKEND_PORT%
if defined RUNNING_PID set "B_UP=1"
call :find_pid %FRONTEND_PORT%
if defined RUNNING_PID set "F_UP=1"
if defined B_UP if defined F_UP exit /b 0
ping 127.0.0.1 -n 2 >nul
set /a WBT+=1
if !WBT! geq 30 exit /b 1
goto wbt_loop

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
echo   Usage: opensign ^<command^> [dev^|prod]
echo.
echo   DEVELOPMENT ^(Vite hot-reload %FRONTEND_PORT% + API %BACKEND_PORT%^):
echo     start dev        start the dev servers
echo     stop dev         stop the Vite dev server ^(leaves the backend up^)
echo.
echo   PRODUCTION ^(what a kiosk runs - built app + API on %BACKEND_PORT%, no HMR^):
echo     start prod       build, then serve the built app + API on %BACKEND_PORT%
echo     stop prod        stop the backend / prod server
echo.
echo   EITHER:
echo     status           what's running, plus the URLs
echo     build            build the frontend without starting anything
echo     restart dev^|prod stop then start that mode
echo     log              follow the logs live
echo     help             this help
echo.
echo   A display should point at the PROD URL ^(%BACKEND_PORT%^), never the Vite dev
echo   server ^(%FRONTEND_PORT%^): the dev server's hot-reload socket drops over a LAN
echo   and forces the page to reload every minute. The built app has no such socket.
echo.
exit /b 0
