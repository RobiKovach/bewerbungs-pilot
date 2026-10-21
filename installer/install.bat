@echo off
setlocal
rem Works from the release root (install.bat next to installer\) and from inside installer\.
set "ROOT=%~dp0"
if not exist "%ROOT%installer\install.ps1" set "ROOT=%~dp0..\"
rem The ready-made app contains server\dist; the source code from GitHub ("Code" > "Download ZIP") does not.
if not exist "%ROOT%server\dist\index.js" goto source
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%installer\install.ps1"
pause
exit /b

:source
echo.
echo This folder holds the BewerbungsPilot source code, not the ready-made app.
echo Please download BewerbungsPilot-vX.Y.Z.zip under "Assets" on
echo   https://github.com/RobiKovach/bewerbungs-pilot/releases/latest
echo unzip it and double-click install.bat there.
echo.
echo Dieser Ordner enthaelt den Quellcode von BewerbungsPilot, nicht das fertige Programm.
echo Bitte laden Sie BewerbungsPilot-vX.Y.Z.zip unter "Assets" herunter:
echo   https://github.com/RobiKovach/bewerbungs-pilot/releases/latest
echo entpacken Sie es und starten Sie dort install.bat.
echo.
pause
exit /b 1
