; Tauri NSIS hooks for the VibeTV Control Center shell.
; The Companion's Scheduled Task holds codexbar-display.exe open; stop it
; before files are replaced and remove it (plus the shell's autostart entry)
; when the customer uninstalls. Updates (/UPDATE) keep the task registered:
; the relaunched shell re-registers it with the new version anyway.
; Task Scheduler reports "stopped" slightly before the process is gone, so
; both hooks kill what is left and give Windows a moment to release the files.

!macro NSIS_HOOK_PREINSTALL
  IfFileExists "$INSTDIR\codexbar-display.exe" 0 +2
    nsExec::ExecToLog '"$INSTDIR\codexbar-display.exe" service stop --label shop.vibetv.control-center.runtime'
  nsExec::ExecToLog 'taskkill /F /IM VibeTVControlCenter.exe'
  nsExec::ExecToLog 'taskkill /F /IM codexbar-display.exe'
  Sleep 1500
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'taskkill /F /IM VibeTVControlCenter.exe'
  IfFileExists "$INSTDIR\codexbar-display.exe" 0 +2
    nsExec::ExecToLog '"$INSTDIR\codexbar-display.exe" service uninstall --label shop.vibetv.control-center.runtime'
  nsExec::ExecToLog 'taskkill /F /IM codexbar-display.exe'
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "VibeTV Control Center"
  Sleep 1500
!macroend
