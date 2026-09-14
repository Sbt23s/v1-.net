<#
.SYNOPSIS
    Builds and publishes the ASP.NET Core (.NET 10) backend and React frontend for Windows Server / IIS hosting.
#>

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Publishing ASP.NET Core (.NET 10) + React for Live IIS" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Publish .NET 10 Backend
Write-Host "`n1. Publishing .NET 10 Backend (Pixous.HrPortal.Api)..." -ForegroundColor Yellow
$backendPublishDir = Join-Path $root "publish-backend-iis"
if (Test-Path $backendPublishDir) { Remove-Item $backendPublishDir -Recurse -Force }

Set-Location (Join-Path $root "backend-dotnet\Pixous.HrPortal.Api")
dotnet publish -c Release -o $backendPublishDir /p:EnvironmentName=Production

if ($LASTEXITCODE -eq 0) {
    Write-Host "  OK  Backend published to: $backendPublishDir" -ForegroundColor Green
} else {
    Write-Host "  !!  Backend publish failed!" -ForegroundColor Red
}

# 2. Build React Frontend for Production
Write-Host "`n2. Building React Frontend..." -ForegroundColor Yellow
Set-Location (Join-Path $root "web")
npm run build

$distDir = Join-Path $root "web\dist"
if (Test-Path (Join-Path $distDir "index.html")) {
    Write-Host "  OK  Frontend built to: $distDir" -ForegroundColor Green
} else {
    Write-Host "  !!  Frontend build failed!" -ForegroundColor Red
}

Set-Location $root

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "  Build Complete! Ready for IIS / Live Hosting." -ForegroundColor Green
Write-Host "  Backend Bundle: $backendPublishDir" -ForegroundColor White
Write-Host "  Frontend Bundle: $distDir" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan
