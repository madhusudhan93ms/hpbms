@echo off
setlocal
cd /d "%~dp0\.."
echo ===============================================================
echo Starting Sri Vijaya Lakshmi Hospital Daily Test Run...
echo ===============================================================
node scripts\run-daily-test-suite.js
exit /b %ERRORLEVEL%
