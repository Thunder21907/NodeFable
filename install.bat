@echo off
setlocal enabledelayedexpansion

title NodeFable Installer

echo =============================================
echo   NodeFable -- Windows Installer
echo =============================================
echo.

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Python is not installed.
    echo.
    echo Would you like to install Python using winget? (Y/N)
    echo (Requires Windows 10 1709+ with App Installer)
    set /p CHOICE=
    if /i "!CHOICE!"=="Y" (
        echo.
        echo Installing Python via winget...
        winget install Python.Python.3.12
        if !errorlevel! neq 0 (
            echo.
            echo Winget installation failed.
            echo Please install Python manually from:
            echo   https://www.python.org/downloads/
            echo.
            echo Make sure to check "Add Python to PATH" during installation.
            echo Then re-run this script.
            pause
            exit /b 1
        )
        echo Python installed successfully.
    ) else (
        echo.
        echo Please download and install Python from:
        echo   https://www.python.org/downloads/
        echo.
        echo Make sure to check "Add Python to PATH" during installation.
        echo Then close this window and re-run the install script.
        pause
        exit /b 1
    )
)

echo Found Python:
python --version

python install.py

echo.
echo Ready! Double-click run_dev.bat to start NodeFable.
pause
