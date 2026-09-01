@echo off
rem Launches DeepSeek Harness from a repository checkout. On the first run it
rem installs dependencies and builds the repository and the fork workspace;
rem later runs reuse the build and start like the desktop shortcut: the fork
rem launcher script reuses a running web host on port 3081 or starts a new
rem one, then opens the desktop app window.

if not exist "%~dp0fork\DeepSeek Harness Desktop.ps1" (
  echo DeepSeek Harness launcher script not found:
  echo   "%~dp0fork\DeepSeek Harness Desktop.ps1"
  echo Clone the full repository, then run this file again.
  pause
  exit /b 1
)

start "DeepSeek Harness" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fork\DeepSeek Harness Desktop.ps1" -Bootstrap
