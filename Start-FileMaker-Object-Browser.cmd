@echo off
setlocal

cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-FileMaker-Object-Browser.ps1" %*
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
  echo.
  echo The FileMaker Object Browser starter ended with exit code %EXIT_CODE%.
  echo Review the messages above.
  pause
)

exit /b %EXIT_CODE%
