# Script PowerShell para Compilar e Instalar en 1 solo paso
$ErrorActionPreference = "Stop"
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "   Free-IPTV Pro - Compilar e Instalar en 1 Clic" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan

Set-Location $PSScriptRoot

Write-Host "`n[1/4] Sincronizando assets web a la carpeta Android..." -ForegroundColor Yellow
npx cap copy android

Write-Host "`n[2/4] Compilando APK con Gradle..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\android"
.\gradlew.bat assembleDebug
Set-Location $PSScriptRoot

$adb = "adb"
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    $fallback = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
    if (Test-Path $fallback) {
        $adb = $fallback
    }
}

$apk = "$PSScriptRoot\android\app\build\outputs\apk\debug\app-debug.apk"
Write-Host "`n[3/4] Instalando APK en tu dispositivo..." -ForegroundColor Yellow
& $adb install -r -d $apk

Write-Host "`n[4/4] Iniciando Free-IPTV Pro en tu móvil..." -ForegroundColor Yellow
& $adb shell am start -n com.freeiptv.app/.MainActivity

Write-Host "`n=========================================================" -ForegroundColor Green
Write-Host "  ¡PROCESO COMPLETADO AL 100%!" -ForegroundColor Green
Write-Host "  La aplicación ya está ejecutándose en tu dispositivo." -ForegroundColor Green
Write-Host "=========================================================`n" -ForegroundColor Green
