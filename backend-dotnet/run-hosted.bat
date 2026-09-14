@echo off
REM ---------------------------------------------------------------------------
REM  Run the .NET backend against the HOSTED production database.
REM
REM  Reads every secret from ..\.env at runtime. Nothing is committed and
REM  nothing is echoed -- this file is safe in source control.
REM
REM  Two things this handles that catch people out:
REM
REM    1. IPv4. The host is resolved to its A record before connecting. On
REM       Windows, "mysql1002.site4now.net" can resolve to IPv6 first, MySQL
REM       answers on IPv4, and the app fails with "Connect Timeout expired"
REM       while the mysql CLI connects fine. This project hit that twice.
REM
REM    2. The connection pool. The hosted account allows 20 connections in
REM       TOTAL across everything using it -- including the Spring backend if
REM       it is running. Six leaves room for a restart briefly running two
REM       copies, and matches DB_POOL_MAX in .env.
REM ---------------------------------------------------------------------------
setlocal EnableDelayedExpansion

for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0..\.env") do (
    set "line=%%A"
    if not "!line:~0,1!"=="#" if not "%%B"=="" set "%%A=%%B"
)

if "%DB_HOST%"=="" (
    echo [x] DB_HOST is not set in .env
    exit /b 1
)
if "%APP_JWT_SECRET%"=="" (
    echo [x] APP_JWT_SECRET is not set in .env
    exit /b 1
)

REM Resolve to IPv4 -- see note 1 above.
for /f %%I in ('powershell -NoProfile -Command "[System.Net.Dns]::GetHostByName('%DB_HOST%').AddressList[0].IPAddressToString"') do set "DB_IP=%%I"

if "%DB_IP%"=="" (
    echo [x] Could not resolve %DB_HOST% to an IPv4 address
    exit /b 1
)

echo   host    : %DB_HOST%  -^>  %DB_IP%
echo   database: %DB_NAME%
echo   pool    : max 6

set "ConnectionStrings__HrPortal=Server=%DB_IP%;Port=%DB_PORT%;Database=%DB_NAME%;User Id=%DB_USER%;Password=%DB_PASSWORD%;SslMode=Preferred;AllowPublicKeyRetrieval=true;MaximumPoolSize=6;MinimumPoolSize=0;ConnectionTimeout=30;DefaultCommandTimeout=60;"
set "App__Jwt__Secret=%APP_JWT_SECRET%"
set "ASPNETCORE_ENVIRONMENT=Hosted"
set "ASPNETCORE_URLS=http://*:7060"

dotnet run --project "%~dp0Pixous.HrPortal.Api" -c Release --no-build --no-launch-profile


endlocal
