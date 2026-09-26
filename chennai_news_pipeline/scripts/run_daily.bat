@echo off
REM Daily runner for Windows Task Scheduler.
REM Uses .venv\Scripts\python.exe when a virtual environment exists, otherwise "python" on PATH.
cd /d "%~dp0.."
set PYTHONIOENCODING=utf-8
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" run_pipeline.py
) else (
    python run_pipeline.py
)
exit /b %ERRORLEVEL%
