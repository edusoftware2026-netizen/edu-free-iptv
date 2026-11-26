@echo off
setlocal
cd /d "%~dp0"

echo =========================================================
echo    Free-IPTV Pro - Compilar e Instalar en 1 Clic
echo =========================================================
echo.

echo [1/5] Limpiando APK anterior para forzar generacion nueva...
if exist "android\app\build\outputs\apk\debug\app-debug.apk" (
    del /f /q "android\app\build\outputs\apk\debug\app-debug.apk"
)

echo.
echo [2/5] Sincronizando assets web a Android...
call npx cap copy android
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Fallo la copia de assets.
    pause
    exit /b 1
)

echo.
echo [3/5] Compilando APK nuevo con Gradle...
cd android
call gradlew.bat assembleDebug
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Fallo la compilacion de Gradle.
    cd ..
    pause
    exit /b 1
)
cd ..

set "ADB_BIN=adb"
where adb >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
        set "ADB_BIN=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
    ) else if exist "%ANDROID_HOME%\platform-tools\adb.exe" (
        set "ADB_BIN=%ANDROID_HOME%\platform-tools\adb.exe"
    )
)

echo.
echo [4/5] Instalando APK nuevo en tu dispositivo...
"%ADB_BIN%" install -r -d "android\app\build\outputs\apk\debug\app-debug.apk"
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] No se pudo instalar el APK en el dispositivo.
    pause
    exit /b 1
)

echo.
echo [5/5] Iniciando Free-IPTV Pro en tu movil...
"%ADB_BIN%" shell am start -n com.freeiptv.app/.MainActivity

echo.
echo =========================================================
echo   PROCESO COMPLETADO AL 100%%
echo   La aplicacion nueva ya esta ejecutandose en tu movil.
echo =========================================================
echo.
pause