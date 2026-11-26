@echo off
setlocal
cd /d "%~dp0"

echo =========================================================
echo    EDU-IPTV PRO - Instalador en Dispositivo
echo =========================================================
echo.

set "ADB_BIN=adb"
where adb >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
        set "ADB_BIN=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
    ) else if exist "%ANDROID_HOME%\platform-tools\adb.exe" (
        set "ADB_BIN=%ANDROID_HOME%\platform-tools\adb.exe"
    ) else (
        echo [ERROR] No se encontro adb en el sistema.
        pause
        exit /b 1
    )
)

echo Usando ADB: "%ADB_BIN%"
echo.
echo [1/3] Verificando dispositivos conectados...
"%ADB_BIN%" devices
echo.

set "APK_PATH=android\app\build\outputs\apk\debug\app-debug.apk"
if not exist "%APK_PATH%" (
    echo [ERROR] No se encontro el archivo APK en %APK_PATH%
    echo Ejecuta compilar.bat primero.
    pause
    exit /b 1
)

echo [2/3] Instalando APK en tu dispositivo...
"%ADB_BIN%" install -r -d "%APK_PATH%"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Fallo la instalacion. Verifica la conexion USB de tu celular.
    pause
    exit /b 1
)

echo.
echo [3/3] Iniciando Free-IPTV Pro en tu dispositivo...
"%ADB_BIN%" shell am start -n com.freeiptv.app/.MainActivity

echo.
echo =========================================================
echo   INSTALACION Y EJECUCION EXITOSA EN TU MOVIL
echo =========================================================
echo.
pause