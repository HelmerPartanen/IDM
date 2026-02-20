; Download Manager NSIS Custom Installer Steps
; Registers the native messaging host in the Windows Registry during install
; and removes it during uninstall.

!macro customInstall
  ; Write Native Messaging Host manifest location to the registry
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.download.manager" "" "$INSTDIR\resources\native-host\com.download.manager.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.download.manager" "" "$INSTDIR\resources\native-host\com.download.manager.json"

  ; Update the native host manifest to point to the installed host executable
  FileOpen $0 "$INSTDIR\resources\native-host\com.download.manager.json" w
  FileWrite $0 '{$\n'
  FileWrite $0 '  "name": "com.download.manager",$\n'
  FileWrite $0 '  "description": "Download Manager Native Messaging Host",$\n'
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
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.download.manager"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.download.manager"
!macroend
