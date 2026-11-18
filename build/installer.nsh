!macro customRemoveFiles
  ; Keep application-owned data in place during upgrades and uninstall.
  FindFirst $R0 $R1 "$INSTDIR\*"
  wetrace_remove_next:
    StrCmp $R1 "" wetrace_remove_done
    StrCmp $R1 "." wetrace_remove_skip
    StrCmp $R1 ".." wetrace_remove_skip
    StrCmp $R1 "WeTrace" wetrace_remove_skip
    IfFileExists "$INSTDIR\$R1\*.*" wetrace_remove_directory wetrace_remove_file
  wetrace_remove_directory:
    RMDir /r "$INSTDIR\$R1"
    Goto wetrace_remove_skip
  wetrace_remove_file:
    Delete "$INSTDIR\$R1"
  wetrace_remove_skip:
    FindNext $R0 $R1
    Goto wetrace_remove_next
  wetrace_remove_done:
    FindClose $R0
    RMDir "$INSTDIR"
!macroend
