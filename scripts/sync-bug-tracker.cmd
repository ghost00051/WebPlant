@echo off
setlocal EnableExtensions

set "REPO=%~dp0.."
set "LOGDIR=%LOCALAPPDATA%\WebPlant"
set "LOG=%LOGDIR%\bug-tracker-sync.log"

if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1
for %%A in ("%LOG%") do if %%~zA GTR 262144 move /y "%LOG%" "%LOGDIR%\bug-tracker-sync.prev.log" >nul 2>&1

set "NODE=%BUG_TRACKER_NODE%"
if defined NODE if not exist "%NODE%" set "NODE="
if not defined NODE for %%N in (node.exe) do if not defined NODE set "NODE=%%~$PATH:N"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE (
  >>"%LOG%" echo [%DATE% %TIME%] ERROR: Node.js not found. Set BUG_TRACKER_NODE to node.exe.
  exit /b 2
)

pushd "%REPO%"
>>"%LOG%" echo [%DATE% %TIME%] sync start (node: %NODE%)
"%NODE%" "scripts\sync-bug-tracker.mjs" >>"%LOG%" 2>&1
set "CODE=%ERRORLEVEL%"
>>"%LOG%" echo [%DATE% %TIME%] sync done, exit=%CODE%
popd

exit /b %CODE%
