@echo off
REM ============================================================
REM  Launch Obsidian with CDP debug port, opening the acceptance vault.
REM  Used by: the real-Obsidian acceptance run (see tests/README.md sec. 5).
REM
REM  Why a launcher: Obsidian takes a **single-instance lock**. If any instance
REM  is already running, a newly spawned one exits immediately and silently
REM  forwards to the existing process -- so --remote-debugging-port never opens
REM  and the CDP scripts can never attach. (Measured 2026-10-03: with an
REM  instance running, the spawned child exits 0 at once and port 9222 stays
REM  closed; with Obsidian fully quit, the scripts' own spawn works fine and the
REM  host lives as their child for the whole run.)
REM  So: either quit Obsidian and let the script spawn it, or use this launcher
REM  to bring one up yourself -- but in both cases the existing instance must be
REM  gone first.
REM
REM  Usage:
REM    scripts\launch-obsidian-debug.cmd [vault-path] [port]
REM
REM  Defaults:
REM    vault = <repo-root>\for-test\acceptance
REM    port  = 9222
REM
REM  Keep this file ASCII-only: .cmd with non-ASCII text can corrupt under
REM  the default console codepage.
REM ============================================================
setlocal

set "PORT=%~2"
if "%PORT%"=="" set "PORT=9222"

set "VAULT=%~1"
if "%VAULT%"=="" set "VAULT=%~dp0..\..\for-test\acceptance"
REM Normalise to an absolute path (works for both the default and a passed-in relative path).
for %%I in ("%VAULT%") do set "VAULT=%%~fI"

set "EXE=%LOCALAPPDATA%\Programs\obsidian\Obsidian.exe"

if not exist "%EXE%" (
  echo [ERROR] Obsidian.exe not found: "%EXE%"
  pause
  exit /b 1
)
if not exist "%VAULT%\.obsidian" (
  echo [ERROR] Acceptance vault not found: "%VAULT%"
  echo         Run "npx vitest run tests/e2e/seed-acceptance.test.ts" first.
  pause
  exit /b 1
)

echo Starting Obsidian...
echo   exe   : %EXE%
echo   vault : %VAULT%
echo   port  : %PORT%
echo.
echo Leave this window open while the acceptance run is in progress.
echo Close the Obsidian window when the run is done.

start "" "%EXE%" --remote-debugging-port=%PORT% "%VAULT%"
endlocal
