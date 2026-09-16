; Tauri NSIS hooks for the VibeTV Control Center shell.
; The Companion's Scheduled Task holds codexbar-display.exe open; stop it
; before files are replaced and remove it (plus the shell's autostart entry)
; when the customer uninstalls. Updates (/UPDATE) keep the task registered:
; the relaunched shell re-registers it with the new version anyway.
; Task Scheduler reports "stopped" slightly before the process is gone, so
; both hooks kill what is left and give Windows a moment to release the files.
; Only this install's Companion is killed: a codexbar-display.exe running from
; anywhere else was never asked for the update hold and may be mid device
; write, so an image-name kill would be the same interruption again.

!define VIBETV_KILL_INSTALLED_COMPANION `nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "Get-Process codexbar-display -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like \"$INSTDIR\*\" } | Stop-Process -Force"'`

!macro NSIS_HOOK_PREINSTALL
  ; An installer launched by hand (not by the shell's updater, which claims
  ; the hold itself) reaches this hook while a firmware update or theme
  ; install may be writing to the device from inside codexbar-display.exe.
  ; "service stop" claims the update hold and exits non-zero while a device
  ; write owns the runtime; the install stops here instead of killing it.
  IfFileExists "$INSTDIR\codexbar-display.exe" 0 install_runtime_done
    nsExec::ExecToLog '"$INSTDIR\codexbar-display.exe" service stop --label shop.vibetv.control-center.runtime'
    Pop $0
    StrCmp $0 "0" install_runtime_done
      MessageBox MB_OK|MB_ICONEXCLAMATION "A VibeTV update or theme install is still running. Wait for it to finish, then run the installer again." /SD IDOK
      Abort
  install_runtime_done:
  nsExec::ExecToLog 'taskkill /F /IM VibeTVControlCenter.exe'
  ${VIBETV_KILL_INSTALLED_COMPANION}
  Sleep 1500
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'taskkill /F /IM VibeTVControlCenter.exe'
  ; A firmware update or theme install runs inside codexbar-display.exe.
  ; "service uninstall" claims the same update hold the shell takes before a
  ; repair and exits non-zero while a device write owns the runtime; killing
  ; the process then would leave the VibeTV half-written, so the uninstall
  ; stops here instead and the customer tries again once the job is done.
  IfFileExists "$INSTDIR\codexbar-display.exe" 0 uninstall_runtime_done
    nsExec::ExecToLog '"$INSTDIR\codexbar-display.exe" service uninstall --label shop.vibetv.control-center.runtime'
    Pop $0
    StrCmp $0 "0" uninstall_runtime_done
      MessageBox MB_OK|MB_ICONEXCLAMATION "A VibeTV update or theme install is still running. Wait for it to finish, then uninstall VibeTV Control Center again." /SD IDOK
      Abort
  uninstall_runtime_done:
  ${VIBETV_KILL_INSTALLED_COMPANION}
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "VibeTV Control Center"
  Sleep 1500
!macroend
