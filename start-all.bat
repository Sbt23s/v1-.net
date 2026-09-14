@echo off
TITLE Pixous HR Portal Launcher
echo =========================================================================
echo  Starting Pixous HR Portal (.NET 10 Backend + React Frontend)
echo =========================================================================
echo.
echo 1. Launching .NET 10 Backend on http://localhost:7060...
start "Pixous HR Portal - Backend" cmd /c "%~dp0start-backend.bat"
echo.
echo 2. Launching React Frontend on http://localhost:5174...
start "Pixous HR Portal - Frontend" cmd /c "%~dp0start-frontend.bat"
echo.
echo All services launched!
echo Web App: http://localhost:5174
echo API Server: http://localhost:7060
echo Actuator Health: http://localhost:7060/actuator/health
echo Swagger Docs: http://localhost:7060/swagger
echo =========================================================================
pause
