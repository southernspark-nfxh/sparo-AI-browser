' Open Sparo the way a Windows user expects: double-click, no command line.
' 1) Installed app  2) Portable / unpacked exe  3) Friendly message

Option Explicit
Dim fso, sh, root, candidates, i, p, msg
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)

candidates = Array( _
  sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\Sparo\Sparo.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Sparo\Sparo.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Sparo\Sparo.exe", _
  root & "\release\win-unpacked\Sparo.exe", _
  root & "\release\Sparo-Portable.exe", _
  root & "\release\Sparo便携版.exe" _
)

For i = 0 To UBound(candidates)
  p = candidates(i)
  If fso.FileExists(p) Then
    sh.Run """" & p & """", 1, False
    WScript.Quit 0
  End If
Next

msg = "还没有安装 Sparo。" & vbCrLf & vbCrLf & _
      "请双击「Sparo-Setup.exe」完成安装。" & vbCrLf & _
      "装好后桌面会有 Sparo 图标，点图标即可打开，不用命令行。" & vbCrLf & vbCrLf & _
      "如果只有便携版，双击「Sparo-Portable.exe」也能直接用。"
MsgBox msg, 64, "Sparo"
WScript.Quit 1
