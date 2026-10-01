' Runs run_intel.bat with no window, so the daily collection cannot be interrupted by closing a console.
' Task Scheduler starts this through wscript.exe (see run_intel.bat for the schedule).
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run """" & dir & "\run_intel.bat""", 0, True
