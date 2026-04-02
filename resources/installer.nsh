!macro customCheckAppRunning
  ; Kill the entire process tree: main app + children (node.exe, MCP servers, WSL)
  ; /T = kill child processes, /F = force (TerminateProcess, no graceful shutdown)
  nsExec::Exec 'taskkill /T /F /IM "Open Cowork.exe"'
  Pop $R0

  ; Kill orphaned node.exe from install directory via PowerShell (wmic is deprecated on Win 11)
  ; Note: $$ escapes the dollar sign in NSIS so PowerShell receives $_ correctly
  nsExec::Exec 'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq ''node.exe'' -and $$_.ExecutablePath -like ''*Open Cowork*'' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
  Pop $R0

  ; Wait for processes to fully exit and release file locks
  Sleep 3000

  _oc_check_app_verify:
  ; Verify no Open Cowork processes remain (main app or orphaned node.exe)
  nsExec::ExecToStack `cmd.exe /c tasklist /FI "IMAGENAME eq Open Cowork.exe" /NH 2>nul | find /C /I "Open Cowork.exe"`
  Pop $R0 ; exit code
  Pop $R1 ; stdout output

  ; Handle error/timeout from ExecToStack — treat as unknown, retry
  StrCmp $R0 "error" _oc_check_app_prompt
  StrCmp $R0 "timeout" _oc_check_app_prompt

  ; exit code 0 means find found a match → process still running
  StrCmp $R0 "0" _oc_check_app_prompt 0

  ; Main exe is gone — also check for orphaned node.exe from install dir
  nsExec::ExecToStack 'powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq ''node.exe'' -and $$_.ExecutablePath -like ''*Open Cowork*'' }).Count"'
  Pop $R0
  Pop $R1
  ; If PowerShell itself failed, treat as unknown → prompt user
  StrCmp $R0 "error" _oc_check_app_prompt
  StrCmp $R0 "timeout" _oc_check_app_prompt
  ; $R1 contains the count (or empty if 0 / PowerShell returned nothing)
  StrCmp $R1 "" _oc_check_app_done
  StrCmp $R1 "0" _oc_check_app_done _oc_check_app_prompt

  _oc_check_app_prompt:
  ; Process is still running — ask the user to close it manually
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION /SD IDCANCEL \
    "Open Cowork is still running and could not be stopped automatically.$\r$\n$\r$\nPlease close Open Cowork manually, then click Retry.$\r$\nClick Cancel to abort the installation." \
    IDRETRY _oc_check_app_retry
  Quit

  _oc_check_app_retry:
    nsExec::Exec 'taskkill /T /F /IM "Open Cowork.exe"'
    Pop $R0
    ; Also re-kill orphaned node.exe from install directory
    nsExec::Exec 'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq ''node.exe'' -and $$_.ExecutablePath -like ''*Open Cowork*'' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
    Pop $R0
    Sleep 3000
    Goto _oc_check_app_verify

  _oc_check_app_done:
!macroend

Function OpenCoworkShowLegacyUninstallHelp
  Exch $0
  DetailPrint `Legacy Open Cowork uninstall failed: $0`

  IfFileExists "$EXEDIR\Open-Cowork-Legacy-Cleanup.cmd" 0 no_cleanup_tool
    MessageBox MB_OK|MB_ICONEXCLAMATION "Open Cowork could not remove the previously installed version.$\r$\n$\r$\nThis usually means the legacy Windows uninstaller is damaged.$\r$\n$\r$\nNext steps:$\r$\n1. Close all Open Cowork windows.$\r$\n2. Run:$\r$\n$EXEDIR\Open-Cowork-Legacy-Cleanup.cmd$\r$\n3. Start this installer again.$\r$\n$\r$\nAdd -RemoveAppData to the cleanup tool only if you also want to clear local settings."
    SetErrorLevel 2
    Quit

  no_cleanup_tool:
    MessageBox MB_OK|MB_ICONEXCLAMATION "Open Cowork could not remove the previously installed version.$\r$\n$\r$\nThis usually means the legacy Windows uninstaller is damaged.$\r$\n$\r$\nPlease close Open Cowork, delete:$\r$\n$LOCALAPPDATA\Programs\Open Cowork$\r$\nand then run this installer again.$\r$\n$\r$\nLocal settings may remain in AppData by design."
    SetErrorLevel 2
    Quit
FunctionEnd

!macro customUnInstallCheck
  IfErrors 0 _oc_uninst_no_launch_err
    Push "could not launch the old uninstaller"
    Call OpenCoworkShowLegacyUninstallHelp
  _oc_uninst_no_launch_err:
  StrCmp $R0 0 _oc_uninst_ok
    Push "old uninstaller returned code $R0"
    Call OpenCoworkShowLegacyUninstallHelp
  _oc_uninst_ok:
!macroend

!macro customUnInstallCheckCurrentUser
  IfErrors 0 _oc_curuninst_no_launch_err
    Push "could not launch the old current-user uninstaller"
    Call OpenCoworkShowLegacyUninstallHelp
  _oc_curuninst_no_launch_err:
  StrCmp $R0 0 _oc_curuninst_ok
    Push "old current-user uninstaller returned code $R0"
    Call OpenCoworkShowLegacyUninstallHelp
  _oc_curuninst_ok:
!macroend
