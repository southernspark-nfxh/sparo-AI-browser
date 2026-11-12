; 默认 GetProcessInfo 会通过 System.dll 枚举进程，本机覆盖安装时在 System.dll+0x1581 访问违例。
; 安装器文件名本来就是 Sparo-Setup，不必先枚举 PID 排除自己；沿用默认 tasklist / taskkill 流程即可。
!macro customCheckAppRunning
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    ${if} ${isUpdated}
      Sleep 1000
      Goto sparoStopProcess
    ${endIf}
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK sparoStopProcess
    Quit

    sparoStopProcess:
    DetailPrint `Closing running "${PRODUCT_NAME}"...`
    nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
    Sleep 300
    StrCpy $R1 0

    sparoWaitForExit:
      IntOp $R1 $R1 + 1
      !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 == 0
        Sleep 1000
        nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
        !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
        ${if} $R0 == 0
          DetailPrint `Waiting for "${PRODUCT_NAME}" to close.`
          Sleep 2000
        ${else}
          Goto sparoNotRunning
        ${endIf}
      ${else}
        Goto sparoNotRunning
      ${endIf}
      ${if} $R1 > 1
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY sparoWaitForExit
        Quit
      ${else}
        Goto sparoWaitForExit
      ${endIf}
    sparoNotRunning:
  ${endIf}
!macroend

!macro customInstall
  ; 快捷方式指向安装目录里的 icon.ico，避免沿用 Sparo.exe 的旧图标缓存。
  CreateShortCut "$DESKTOP\Sparo.lnk" "$INSTDIR\Sparo.exe" "" "$INSTDIR\icon.ico" 0
  CreateShortCut "$SMPROGRAMS\Sparo.lnk" "$INSTDIR\Sparo.exe" "" "$INSTDIR\icon.ico" 0
!macroend
