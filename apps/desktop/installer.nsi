; Build the installer and uninstaller together. No Windows emulation is needed
; to create an unsigned installer on Linux; signature/checksum checks stay enabled.
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "${BUILD_RESOURCES_DIR}/verify-vc-command.nsh"
Unicode true
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\L-BOT"
InstallDirRegKey HKCU "Software\TC Social Assistant" "InstallLocation"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro addLangs

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "L-BOT需要 64 位 Windows。"
    Abort
  ${EndIf}
  SetRegView 64
  SetShellVarContext current
FunctionEnd

Section "安装L-BOT"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=vc_redist.x64.exe "${BUILD_RESOURCES_DIR}/prerequisites/vc_redist.x64.exe"
  DetailPrint "验证 Microsoft 签名与校验值；缺少系统运行库时 Windows 会请求你的授权。"
  System::Call 'kernel32::SetEnvironmentVariableW(w "TC_VC_INSTALLER", w "$PLUGINSDIR\vc_redist.x64.exe")i.r0'
  ExecWait '$\"$WINDIR\sysnative\WindowsPowerShell\v1.0\powershell.exe$\" -NoProfile -NonInteractive -EncodedCommand ${TC_VC_COMMAND}' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Microsoft Visual C++ x64 运行库验证或安装未完成。可能是签名/校验失败、系统策略阻止操作，或你取消了 Windows 授权。安装已停止；不会运行未经验证的组件。"
    Abort
  ${EndIf}
  File /oname=app.7z "${APP_64}"
  SetOutPath "$INSTDIR"
  ClearErrors
  nsis7z::Extract "$PLUGINSDIR\app.7z"
  IfErrors installation_failed
  IfFileExists "$INSTDIR\L-BOT.exe" installation_ok installation_failed
  installation_failed:
  MessageBox MB_ICONSTOP "安装文件解压失败。请检查可用磁盘空间并重新下载安装包。"
  Abort
  installation_ok:
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\L-BOT"
  CreateShortcut "$SMPROGRAMS\L-BOT\L-BOT.lnk" "$INSTDIR\L-BOT.exe"
  CreateShortcut "$DESKTOP\L-BOT.lnk" "$INSTDIR\L-BOT.exe"
  WriteRegStr HKCU "Software\TC Social Assistant" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TC Social Assistant" "DisplayName" "L-BOT"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TC Social Assistant" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TC Social Assistant" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TC Social Assistant" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TC Social Assistant" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TC Social Assistant" "NoRepair" 1
SectionEnd

Function un.onInit
  SetRegView 64
  SetShellVarContext current
FunctionEnd
Section "Uninstall"
  Delete "$DESKTOP\L-BOT.lnk"
  Delete "$SMPROGRAMS\L-BOT\L-BOT.lnk"
  RMDir "$SMPROGRAMS\L-BOT"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TC Social Assistant"
  DeleteRegKey HKCU "Software\TC Social Assistant"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "TC Social Assistant"
  ; Encrypted personal data and downloaded models are stored in userData,
  ; outside this installation directory, and are preserved by uninstallation.
  RMDir /r "$INSTDIR"
SectionEnd
