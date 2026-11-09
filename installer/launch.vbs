' Starts the BewerbungsPilot server without a console window.
' The server itself reuses an already running instance and opens the browser.
' 0.12.0: a "Starting..." tab opens at once (installer\starting.html with a one-time launch code); it moves to the
' app as soon as the server answers. If anything here fails, the server opens the browser itself, as before.
Option Explicit
Dim fso, sh, appDir, nodeExe, nodePathFile, f, code, page
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

code = NewCode()
page = ""
If code <> "" Then page = WriteStartingPage(code)
If page <> "" Then sh.Environment("PROCESS")("BP_LAUNCH_CODE") = code

sh.CurrentDirectory = appDir
sh.Run """" & nodeExe & """ """ & appDir & "\server\dist\index.js""", 0, False
If page <> "" Then
  On Error Resume Next
  sh.Run """" & page & """", 1, False
  On Error GoTo 0
End If

' 64 hex characters from two random GUIDs (Windows' CoCreateGuid); "" when that is not available.
Function NewCode()
  Dim g, i, s, re
  NewCode = ""
  On Error Resume Next
  s = ""
  For i = 1 To 2
    g = CreateObject("Scriptlet.TypeLib").Guid
    If Err.Number <> 0 Then Exit Function
    s = s & Replace(Mid(g, 2, 36), "-", "")
  Next
  On Error GoTo 0
  s = LCase(s)
  Set re = New RegExp
  re.Pattern = "^[0-9a-f]{64}$"
  If re.Test(s) Then NewCode = s
End Function

' <data>\tmp\launch\starting-<first 16 of the code>.html (UTF-8); "" on any failure.
Function WriteStartingPage(c)
  Dim dataDir, dir, template, html, target, inStream, outStream
  WriteStartingPage = ""
  On Error Resume Next
  template = appDir & "\installer\starting.html"
  If Not fso.FileExists(template) Then Exit Function
  ' The same folder the server uses (server/src/data/paths.ts): BP_DATA_DIR for test copies, else %LOCALAPPDATA%.
  dataDir = sh.Environment("PROCESS")("BP_DATA_DIR")
  If dataDir = "" Then dataDir = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\BewerbungsPilot"
  dir = dataDir & "\tmp\launch"
  If Not fso.FolderExists(dataDir) Then fso.CreateFolder dataDir
  If Not fso.FolderExists(dataDir & "\tmp") Then fso.CreateFolder dataDir & "\tmp"
  If Not fso.FolderExists(dir) Then fso.CreateFolder dir
  Set inStream = CreateObject("ADODB.Stream")
  inStream.Type = 2
  inStream.Charset = "utf-8"
  inStream.Open
  inStream.LoadFromFile template
  html = inStream.ReadText
  inStream.Close
  If InStr(html, "__BP_LAUNCH_CODE__") = 0 Then Exit Function
  html = Replace(html, "__BP_LAUNCH_CODE__", c)
  target = dir & "\starting-" & Left(c, 16) & ".html"
  Set outStream = CreateObject("ADODB.Stream")
  outStream.Type = 2
  outStream.Charset = "utf-8"
  outStream.Open
  outStream.WriteText html
  outStream.SaveToFile target, 2
  outStream.Close
  If Err.Number <> 0 Then Exit Function
  WriteStartingPage = target
End Function
