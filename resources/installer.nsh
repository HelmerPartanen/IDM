; IDM Clone NSIS Custom Installer Steps
; Registers the native messaging host in the Windows Registry during install
; and removes it during uninstall.

!macro customInstall
  ; Write Native Messaging Host manifest location to the registry
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.idm.clone" "" "$INSTDIR\resources\native-host\com.idm.clone.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.idm.clone" "" "$INSTDIR\resources\native-host\com.idm.clone.json"

  ; Update the native host manifest to point to the installed host executable
  FileOpen $0 "$INSTDIR\resources\native-host\com.idm.clone.json" w
  FileWrite $0 '{$\n'
  FileWrite $0 '  "name": "com.idm.clone",$\n'
  FileWrite $0 '  "description": "IDM Clone Native Messaging Host",$\n'
  FileWrite $0 '  "path": "$INSTDIR\\resources\\native-host\\host.exe",$\n'
  FileWrite $0 '  "type": "stdio",$\n'
  FileWrite $0 '  "allowed_origins": [$\n'
  FileWrite $0 '    "chrome-extension://YOUR_EXTENSION_ID/"$\n'
  FileWrite $0 '  ]$\n'
  FileWrite $0 '}$\n'
  FileClose $0
!macroend

!macro customUnInstall
  ; Remove Native Messaging Host registry entries
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.idm.clone"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.idm.clone"
!macroend
