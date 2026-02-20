; NSIS include to register native messaging host manifests for Chrome and Edge
; This file is included by electron-builder's NSIS script via the `nsis.include` option.

Function .onInstSuccess
  ; Register native host for Chrome (current user)
  WriteRegStr HKCU "Software\\Google\\Chrome\\NativeMessagingHosts\\com.idm.clone" "" "$INSTDIR\\resources\\native-host\\com.idm.clone.json"

  ; Register native host for Edge (current user)
  WriteRegStr HKCU "Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.idm.clone" "" "$INSTDIR\\resources\\native-host\\com.idm.clone.json"

  ; Optional: you can log the registration to a file for debugging
  ; FileOpen $0 "$INSTDIR\\native-host\\install.log" a
  ; FileWrite $0 "Registered native host to HKCU for Chrome and Edge\n"
  ; FileClose $0
FunctionEnd

Function un.onUninstSuccess
  ; Remove registry entries on uninstall
  DeleteRegKey HKCU "Software\\Google\\Chrome\\NativeMessagingHosts\\com.idm.clone"
  DeleteRegKey HKCU "Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.idm.clone"
FunctionEnd
