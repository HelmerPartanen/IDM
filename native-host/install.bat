@echo off
echo ============================================
echo  DOWNLOAD MANAGER - Native Messaging Host Setup
echo ============================================
echo.

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0

REM Set the path to the manifest file
set MANIFEST_PATH=%SCRIPT_DIR%com.dm.clone.json

echo Registering native messaging host...
echo Manifest path: %MANIFEST_PATH%
echo.

REM Add registry key for Chrome
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.dm.clone" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f

if %errorlevel% equ 0 (
    echo.
    echo SUCCESS: Native messaging host registered for Chrome.
    echo.
    echo IMPORTANT: Update com.dm.clone.json with:
    echo   1. The correct path to dm-native-host.exe
    echo   2. Your Chrome extension ID in allowed_origins
) else (
    echo.
    echo ERROR: Failed to register native messaging host.
    echo Try running this script as administrator.
)

echo.
pause
