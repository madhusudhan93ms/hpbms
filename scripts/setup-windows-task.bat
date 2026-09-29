@echo off
setlocal
echo ===============================================================
echo Setting up Daily 9:00 AM Windows Scheduled Task...
echo ===============================================================

set "BATCH_PATH=%~dp0run-daily-tests.bat"
set "TASK_NAME=HospitalDailyTestReport"

schtasks /Create /SC DAILY /TN "%TASK_NAME%" /TR "\"%BATCH_PATH%\"" /ST 09:00 /F

if %ERRORLEVEL% equ 0 (
    echo.
    echo [SUCCESS] Windows Scheduled Task '%TASK_NAME%' created successfully!
    echo It will run automatically every day at 09:00 AM.
    echo.
    schtasks /Query /TN "%TASK_NAME%"
) else (
    echo.
    echo [NOTE] If permission was denied, please right-click this script and select 'Run as Administrator'.
)

pause
