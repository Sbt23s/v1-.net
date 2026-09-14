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
$env:VITE_API_URL = ""
npm run build

$distDir = Join-Path $root "web\dist"
if (Test-Path (Join-Path $distDir "index.html")) {
    Write-Host "  OK  Frontend built to: $distDir" -ForegroundColor Green

    # Copy frontend into backend's wwwroot for unified single-site IIS deployment
    $backendWwwRoot = Join-Path $backendPublishDir "wwwroot"
    if (-not (Test-Path $backendWwwRoot)) { New-Item -ItemType Directory -Path $backendWwwRoot -Force | Out-Null }
    Copy-Item -Path (Join-Path $distDir "*") -Destination $backendWwwRoot -Recurse -Force
    Write-Host "  OK  Frontend copied into: $backendWwwRoot (Unified IIS Site ready)" -ForegroundColor Green
} else {
    Write-Host "  !!  Frontend build failed!" -ForegroundColor Red
}

Set-Location $root

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "  Build Complete! Ready for Windows Hosting & IIS." -ForegroundColor Green
Write-Host "  Target Domain:  https://pixoushrportal.pixous.info" -ForegroundColor White
Write-Host "  Unified Bundle: $backendPublishDir" -ForegroundColor White
Write-Host "  Frontend Only:  $distDir" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "`nDeployment Options for https://pixoushrportal.pixous.info:" -ForegroundColor Yellow
Write-Host "  Option A (Recommended - Single Unified Site in IIS):"
Write-Host "    1. Point IIS Site Physical Path directly to: $backendPublishDir"
Write-Host "    2. Set AppPool .NET CLR Version to 'No Managed Code'"
Write-Host "    3. Set Application Pool Environment Variables:"
Write-Host "         ConnectionStrings__HrPortal"
Write-Host "         App__Jwt__Secret"
Write-Host "    4. Bind Domain: pixoushrportal.pixous.info (HTTP: 80, HTTPS: 443 with SSL)"
Write-Host "`n  Option B (Separate Frontend and Backend):"
Write-Host "    Frontend: Upload $distDir contents to wwwroot"
Write-Host "    Backend:  Deploy $backendPublishDir to IIS or Windows Service"
Write-Host "==========================================================" -ForegroundColor Cyan
