@echo off
TITLE Publish ASP.NET Core Backend + React for Live IIS Hosting
cls
echo ====================================================================
echo   Publishing ASP.NET Core (.NET) Backend + React for Live IIS
echo ====================================================================
echo.

echo 1. Publishing ASP.NET Core Backend (backend-dotnet\Pixous.HrPortal.Api)...
cd /d "%~dp0backend-dotnet\Pixous.HrPortal.Api"
dotnet publish -c Release -o "%~dp0publish-backend-iis" /p:EnvironmentName=Production
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Backend publish failed! Check dotnet installation.
    pause
    exit /b %ERRORLEVEL%
)
echo   [OK] Backend publish completed: %~dp0publish-backend-iis

echo.
echo 2. Building React Frontend for Production...
cd /d "%~dp0web"
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Frontend build failed! Check npm installation.
    pause
    exit /b %ERRORLEVEL%
)
echo   [OK] Frontend build completed: %~dp0web\dist

cd /d "%~dp0"

echo.
echo ====================================================================
echo   Build Complete! Ready for IIS / Live Hosting.
echo   * Backend Bundle:  %~dp0publish-backend-iis
echo   * Frontend Bundle: %~dp0web\dist
echo ====================================================================
echo.
pause
