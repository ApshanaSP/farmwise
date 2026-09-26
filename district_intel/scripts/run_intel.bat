@echo off
REM District Intelligence: refresh the sources that are due, then rebuild the curated store.
REM Schedule with Task Scheduler, for example every 30 minutes:
REM   schtasks /Create /TN "DistrictIntel" /SC MINUTE /MO 30 /TR "\"D:\farmwisenew\district_intel\scripts\run_intel.bat\"" /RL LIMITED /F
cd /d "%~dp0.."
if exist "..\chennai_news_pipeline\.venv\Scripts\python.exe" (
  set PY="..\chennai_news_pipeline\.venv\Scripts\python.exe"
) else (
  set PY=python
)
set PYTHONIOENCODING=utf-8
%PY% run_pipeline.py refresh >> output\refresh.log 2>&1
