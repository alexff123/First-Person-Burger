@echo off
setlocal enabledelayedexpansion
title Cooking Game Launcher

:: ============================================================
::  Cooking Game - One Click Launcher  (v3)
::
::  KEEP THIS FILE PURE ASCII.
::  Chinese (or any non-ASCII) text in a .bat makes cmd lose track of
::  its file position, the "::" prefix gets eaten, and comment lines
::  are then executed as commands. Learned the hard way - do not
::  reintroduce non-ASCII characters here.
::
::  v2 fixes:
::   1) curl probing was hijacked by the system HTTP proxy. The request
::      went to the proxy, which answered 502; curl still returned 0
::      because the HTTP transaction completed, so the launcher wrongly
::      believed a server was already running, skipped startup and
::      opened a dead page.
::      Fixed by clearing proxy variables and adding --noproxy "*" -f.
::   2) The window used to close on success, which looked like a crash.
::      Fixed: every exit path ends with pause, and the whole run is
::      written to game\launcher.log
::
::  Self-test hook:  start-game.bat probe 5173   (prints ALIVE=0/1)
:: ============================================================

set "PROJECT_ROOT=C:\Users\13916\Documents\work buddy\2026-09-18-19-45-04"
set "NODE_DIR=C:\Users\13916\.workbuddy\binaries\node\versions\22.22.2-3"
set "PORT=5173"
set "HAS_CURL=0"

:: A loopback address must never go through a proxy. Clearing these
:: also keeps the spawned npm/vite process proxy-free.
set "http_proxy="
set "https_proxy="
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
set "all_proxy="
set "NO_PROXY=*"

set "HERE=%~dp0"
if exist "!HERE!game\node_modules" ( set "GAME_DIR=!HERE!game" ) else ( set "GAME_DIR=!PROJECT_ROOT!\game" )

where curl >nul 2>&1
if not errorlevel 1 set "HAS_CURL=1"

:: ---------- self-test hook: probe only, no side effects ----------
if /i "%~1"=="probe" (
  call :probe %~2
  echo ALIVE=!ALIVE!
  exit /b !ALIVE!
)

if not exist "!GAME_DIR!" (
  echo  [ERROR] game folder not found.
  echo          tried: !HERE!game
  echo          tried: !PROJECT_ROOT!\game
  echo.
  pause
  exit /b 1
)

:: %TIME% only - %DATE% would inject a localized weekday name and spoil
:: the otherwise pure-ASCII log file.
> "!GAME_DIR!\launcher.log" echo === launcher start %TIME% ===

call :say "=========================================="
call :say "  Cooking Game  -  One Click Launcher"
call :say "=========================================="
call :say ""

if exist "%NODE_DIR%\node.exe" (
  set "PATH=!NODE_DIR!;!PATH!"
  set "NPM=!NODE_DIR!\npm.cmd"
  call :say "[env] node runtime : managed"
) else (
  set "NPM=npm"
  call :say "[env] node runtime : system fallback"
)
call :say "[env] game folder  : !GAME_DIR!"
call :say "[env] curl usable  : !HAS_CURL!"
call :say ""

call :probe 5173
call :say "[probe] port 5173 : ALIVE=!ALIVE!"
if "!ALIVE!"=="1" (
  call :say "[1/3] port 5173 already answering - reusing it."
  goto :open
)

:: 5173 may be taken by something else; in that case Vite moves to 5174
call :probe 5174
if "!ALIVE!"=="1" (
  set "PORT=5174"
  call :say "[1/3] port 5174 already answering - reusing it."
  goto :open
)

call :say "[2/3] starting the Vite dev server ..."

if not exist "!GAME_DIR!\node_modules" (
  call :say "      node_modules missing - running npm install first, please wait ..."
  pushd "!GAME_DIR!"
  call "!NPM!" install
  popd
)

start "CookingGame-DevServer" /D "!GAME_DIR!" cmd /k "!NPM! run dev"
call :say "      launched in the separate window 'CookingGame-DevServer'."

call :say "[3/3] waiting for the server to answer ..."

if "!HAS_CURL!"=="0" (
  call :say "      curl not found - waiting 8 seconds instead."
  ping -n 9 127.0.0.1 >nul
  goto :open
)

set /a tries=0
:WAIT
set /a tries+=1
if !tries! gtr 40 goto :TIMEOUT
call :probe 5173
if "!ALIVE!"=="1" goto :open
call :probe 5174
if "!ALIVE!"=="1" (
  set "PORT=5174"
  goto :open
)
ping -n 2 127.0.0.1 >nul
goto :WAIT

:open
call :say ""
call :say "[DONE] server : http://localhost:!PORT!/"
call :say "[DONE] page   : http://localhost:!PORT!/cook.html"
start "" "http://localhost:!PORT!/cook.html"
call :say ""
call :say "The server runs in the separate window 'CookingGame-DevServer'."
call :say "Close that window to stop the server. Press any key to close this one."
echo.
pause
exit /b 0

:TIMEOUT
call :say ""
call :say "[ERROR] the server did not answer within 40 seconds."
call :say "        Switch to the 'CookingGame-DevServer' window and read the error there."
call :say "        This run was logged to game\launcher.log"
echo.
pause
exit /b 1

:probe
:: probe PORT  :  sets ALIVE=1 when that port really serves cook.html
::
:: --noproxy "*" forces a direct connection (a proxy would answer 502 and
:: curl would still report success). -f turns HTTP 4xx/5xx into a non-zero
:: exit code. Both are required, see the header note.
::
:: Try "localhost" FIRST, then 127.0.0.1. On Windows, Vite binds to the
:: IPv6 loopback ::1 only, so probing 127.0.0.1 alone gives a false
:: negative. The second attempt covers setups bound to IPv4 instead.
set "ALIVE=0"
if "!HAS_CURL!"=="0" exit /b 0
curl -sf --noproxy "*" -o nul --max-time 2 "http://localhost:%~1/cook.html" >nul 2>&1
if not errorlevel 1 set "ALIVE=1"
if "!ALIVE!"=="1" exit /b 0
curl -sf --noproxy "*" -o nul --max-time 2 "http://127.0.0.1:%~1/cook.html" >nul 2>&1
if not errorlevel 1 set "ALIVE=1"
exit /b 0

:say
:: Print to both the console and the log file.
::
:: NEVER pass a message containing the characters  >  <  |  &
:: :say strips the surrounding quotes and echoes the text unquoted, so cmd
:: would treat such a character as redirection. That once turned the probe
:: line "[probe] port 5173 - ALIVE=1" into a stray file named ALIVE and
:: silently swallowed the log entry.
if "%~1"=="" (
  echo.
  >>"!GAME_DIR!\launcher.log" echo.
  exit /b 0
)
echo %~1
>>"!GAME_DIR!\launcher.log" echo %~1
exit /b 0
