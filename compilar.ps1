# Script PowerShell para compilar Free-IPTV Pro
$ErrorActionPreference = "Stop"
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "   Free-IPTV Pro - Compilador de APK" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan

Set-Location $PSScriptRoot

Write-Host "`n[1/2] Sincronizando assets web a la carpeta Android..." -ForegroundColor Yellow
npx cap copy android

Write-Host "`n[2/2] Compilando APK Debug con Gradle..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\android"
.\gradlew.bat assembleDebug

Set-Location $PSScriptRoot
Write-Host "`n=========================================================" -ForegroundColor Green
Write-Host "  ¡COMPILACION EXITOSA!" -ForegroundColor Green
Write-Host "  APK: android\app\build\outputs\apk\debug\app-debug.apk" -ForegroundColor Green
Write-Host "=========================================================`n" -ForegroundColor Green
