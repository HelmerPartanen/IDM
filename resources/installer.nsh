; Download Manager NSIS Custom Installer Steps
; Registers the native messaging host in the Windows Registry during install
; and removes it during uninstall.

!macro customInstall
  ; Write Native Messaging Host manifest location to the registry for Chrome and Edge
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.idm.clone" "" "$INSTDIR\resources\native-host\com.idm.clone.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.idm.clone" "" "$INSTDIR\resources\native-host\com.idm.clone.json"
!macroend

!macro customUnInstall
  ; Remove Native Messaging Host registry entries on uninstall
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.idm.clone"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.idm.clone"
!macroend
