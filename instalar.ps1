# Script PowerShell para instalar Free-IPTV Pro en dispositivo móvil
$ErrorActionPreference = "Stop"
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "   Free-IPTV Pro - Instalador en Dispositivo Móvil" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan

Set-Location $PSScriptRoot

$adb = "adb"
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    $fallback = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
    if (Test-Path $fallback) {
        $adb = $fallback
    } else {
        Write-Error "No se encontró adb.exe en el sistema."
        exit 1
    }
}

Write-Host "`n[1/3] Dispositivos conectados:" -ForegroundColor Yellow
& $adb devices

$apk = "$PSScriptRoot\android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $apk)) {
    Write-Error "No se encontró el APK en $apk. Ejecuta .\compilar.ps1 primero."
    exit 1
}

Write-Host "`n[2/3] Instalando APK en tu dispositivo..." -ForegroundColor Yellow
& $adb install -r -d $apk

Write-Host "`n[3/3] Iniciando Free-IPTV Pro..." -ForegroundColor Yellow
& $adb shell am start -n com.freeiptv.app/.MainActivity

Write-Host "`n=========================================================" -ForegroundColor Green
Write-Host "  ¡APLICACION INSTALADA Y LANZADA CON EXITO!" -ForegroundColor Green
Write-Host "=========================================================`n" -ForegroundColor Green
