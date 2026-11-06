' Chay 02-copy-report.bat o che do an (khong hien cua so CMD tren man hinh may san xuat).
' Chi dung cho che do USER (task chay duoi user dang dang nhap).
' Che do SYSTEM chay ngam san nen goi thang file .bat.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
rc = sh.Run("cmd.exe /c """ & dir & "\02-copy-report.bat""", 0, True)
WScript.Quit rc
