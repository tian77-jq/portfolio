@echo off
rem ============================================================
rem  Agent Portfolio Hub - start gateway + open hub page
rem  Real backend: routes @project messages to local adapters
rem  (MCP stdio). Requires the four project venvs on this machine.
rem ============================================================
setlocal
cd /d "%~dp0"

echo [hub] starting gateway on http://127.0.0.1:8250 ...
start "hub-gateway" cmd /k python server\hub_server.py --port 8250

rem wait for the port to come up, then open the page
ping -n 4 127.0.0.1 >nul
start "" http://127.0.0.1:8250/hub.html

echo [hub] if the browser shows "not connected", check the hub-gateway window for errors.
endlocal
