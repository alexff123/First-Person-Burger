@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Cooking Game Launcher

:: ============================================================
::  Cooking Game - One Click Launcher
::  Double click this file. It will:
::    1) locate the game folder
::    2) start the Vite dev server in its own window
::    3) wait until the server actually answers
::    4) open the browser at cook.html
::  Close the "CookingGame-DevServer" window to stop the server.
:: ============================================================

set "PROJECT_ROOT=C:\Users\13916\Documents\work buddy\2026-09-18-19-45-04"
set "NODE_DIR=C:\Users\13916\.workbuddy\binaries\node\versions\22.22.2-3"
set "PORT=5173"
set "HAS_CURL=0"

:: Prefer the folder this file lives in (normal case: project root).
:: Fall back to the hardcoded root so a copy placed elsewhere still works.
set "HERE=%~dp0"
if exist "!HERE!game\node_modules" (
  set "GAME_DIR=!HERE!game"
) else (
  set "GAME_DIR=!PROJECT_ROOT!\game"
)

where curl >nul 2>&1
if not errorlevel 1 set "HAS_CURL=1"

echo.
echo  ==========================================
echo   Cooking Game  -  One Click Launcher
echo  ==========================================
echo.

if exist "%NODE_DIR%\node.exe" (
  set "PATH=!NODE_DIR!;!PATH!"
  set "NPM=!NODE_DIR!\npm.cmd"
  echo  [env] Node runtime : managed
) else (
  set "NPM=npm"
  echo  [env] Node runtime : system fallback
)

if not exist "!GAME_DIR!" (
  echo  [ERROR] Game folder not found.
  echo          Tried: !HERE!game
  echo          Tried: !PROJECT_ROOT!\game
  echo.
  pause
  exit /b 1
)

echo  [env] Game folder  : !GAME_DIR!
echo.

call :probe 5173
if "!ALIVE!"=="1" (
  echo  [1/3] Server is already running on port 5173 - reusing it.
  goto :open
)

echo  [2/3] Starting Vite dev server ...

if not exist "!GAME_DIR!\node_modules" (
  echo        node_modules missing - running npm install first (may take a while) ...
  pushd "!GAME_DIR!"
  call "!NPM!" install
  popd
)

start "CookingGame-DevServer" /D "!GAME_DIR!" cmd /k "!NPM! run dev"

echo  [3/3] Waiting for the server to answer ...

if "!HAS_CURL!"=="0" (
  echo        curl not found - waiting 8 seconds instead.
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
echo.
echo  [OK] Server  : http://localhost:!PORT!/
echo  [OK] Opening : http://localhost:!PORT!/cook.html
start "" "http://localhost:!PORT!/cook.html"
echo.
echo  The dev server keeps running in the window titled "CookingGame-DevServer".
echo  Close that window to stop the server.
echo.
ping -n 4 127.0.0.1 >nul
exit /b 0

:TIMEOUT
echo.
echo  [ERROR] The server did not answer within 40 seconds.
echo          Switch to the "CookingGame-DevServer" window and read the error there.
echo.
pause
exit /b 1

:probe
:: probe ^<port^> -^> sets ALIVE=1 when that port serves cook.html
set "ALIVE=0"
if "!HAS_CURL!"=="0" exit /b 0
curl -s -o nul --max-time 2 "http://localhost:%~1/cook.html" >nul 2>&1
if not errorlevel 1 set "ALIVE=1"
exit /b 0
