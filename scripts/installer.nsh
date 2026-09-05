!macro customInstall
  ; 快捷方式指向安装目录里的 icon.ico，避免沿用 Sparo.exe 的旧图标缓存。
  CreateShortCut "$DESKTOP\Sparo.lnk" "$INSTDIR\Sparo.exe" "" "$INSTDIR\icon.ico" 0
  CreateShortCut "$SMPROGRAMS\Sparo.lnk" "$INSTDIR\Sparo.exe" "" "$INSTDIR\icon.ico" 0
!macroend
