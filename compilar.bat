@echo off
setlocal
cd /d "%~dp0"

echo =========================================================
echo    EDU-IPTV PRO - Compilador de APK
echo =========================================================
echo.

echo [1/3] Limpiando APK anterior para forzar generacion nueva...
if exist "android\app\build\outputs\apk\debug\app-debug.apk" (
    del /f /q "android\app\build\outputs\apk\debug\app-debug.apk"
)

echo.
echo [2/3] Sincronizando assets web a la carpeta Android...
call npx cap copy android
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Fallo la copia de assets con Capacitor.
    pause
    exit /b 1
)

echo.
echo [3/3] Compilando APK Debug con Gradle...
cd android
call gradlew.bat assembleDebug
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Fallo la compilacion de Gradle.
    cd ..
    pause
    exit /b 1
)

cd ..
echo.
echo =========================================================
echo   COMPILACION EXITOSA
echo   APK generado en:
echo   android\app\build\outputs\apk\debug\app-debug.apk
echo =========================================================
echo.
pause