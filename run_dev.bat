@echo off
setlocal

title NodeFable

if exist venv\Scripts\activate.bat (
    call venv\Scripts\activate.bat
) else (
    echo Error: Virtual environment not found.
    echo Please run install.bat first.
    pause
    exit /b 1
)

echo Starting NodeFable server on http://localhost:8005...

start "" http://localhost:8005/editor

uvicorn backend.main:app --host 127.0.0.1 --port 8005

pause
