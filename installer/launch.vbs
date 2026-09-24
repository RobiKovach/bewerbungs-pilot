' Starts the BewerbungsPilot server without a console window.
' The server itself reuses an already running instance and opens the browser.
Option Explicit
Dim fso, sh, appDir, nodeExe, nodePathFile, f
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
nodeExe = "node"
nodePathFile = appDir & "\installer\node-path.txt"
If fso.FileExists(nodePathFile) Then
  Set f = fso.OpenTextFile(nodePathFile, 1, False, -1)
  nodeExe = Trim(f.ReadLine)
  f.Close
End If
sh.CurrentDirectory = appDir
sh.Run """" & nodeExe & """ """ & appDir & "\server\dist\index.js""", 0, False
