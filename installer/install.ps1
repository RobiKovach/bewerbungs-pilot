#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$ReleaseRoot = Split-Path -Parent $PSScriptRoot
$AppDir = Join-Path $env:LOCALAPPDATA 'Programs\BewerbungsPilot'
$DataDir = Join-Path $env:LOCALAPPDATA 'BewerbungsPilot'
$Wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$Launcher = Join-Path $AppDir 'installer\launch.vbs'

$Messages = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'messages.json') | ConvertFrom-Json
$Lang = (Get-Culture).TwoLetterISOLanguageName

function Say([string]$Key) {
  Write-Host $Messages.en.$Key
  if ($Lang -ne 'en' -and ($Messages.PSObject.Properties.Name -contains $Lang)) {
    Write-Host $Messages.$Lang.$Key -ForegroundColor Cyan
  }
}
function Ask([string]$Key) {
  Say $Key
  $answer = Read-Host '>'
  # Y(es) / J(a) / T(ak) / D(a) / Т(ак) / Д(а)
  return ($answer -match '^[YyJjTtDdТтДд]')
}
function Fail([string]$Detail) {
  Say 'installFailed'
  Write-Host $Detail -ForegroundColor Red
  exit 1
}
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Find-Claude {
  $cmd = Get-Command claude -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $native = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
  if (Test-Path $native) { return $native }
  return $null
}

Say 'title'

# 1. Node.js >= 20
Say 'checkingNode'
$major = 0
if (Get-Command node -ErrorAction SilentlyContinue) { $major = [int](& node -p "process.versions.node.split('.')[0]") }
if ($major -lt 20) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Say 'wingetMissing'; exit 1 }
  if (-not (Ask 'nodeMissing')) { Say 'aborted'; exit 1 }
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) { Fail "winget exit code $LASTEXITCODE" }
  Refresh-Path
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'node not found after installation' }
}
$NodeExe = (Get-Command node).Source

# 2. Claude Code
Say 'checkingClaude'
$Claude = Find-Claude
if (-not $Claude) {
  if (-not (Ask 'claudeMissing')) { Say 'aborted'; exit 1 }
  & powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"
  Refresh-Path
  $Claude = Find-Claude
  if (-not $Claude) { Fail 'claude not found after installation' }
}

# 3. Stop a running copy (update case), then copy the app. User data in $DataDir is never touched.
$ServerJson = Join-Path $DataDir 'server.json'
if (Test-Path $ServerJson) {
  try {
    $info = Get-Content -Raw $ServerJson | ConvertFrom-Json
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($info.port)/api/shutdown" -Headers @{ 'X-BP-Client' = '1' } -ContentType 'application/json' -Body '{}' -TimeoutSec 3 | Out-Null
  } catch { }
  # Wait (max. 15 s) until the old server process has really exited, so its files are no longer in use.
  if ($info -and $info.pid) {
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Process -Id $info.pid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 250
    }
  }
}
Say 'copying'
if (Test-Path $AppDir) { Remove-Item $AppDir -Recurse -Force }
New-Item -ItemType Directory -Force $AppDir | Out-Null
Copy-Item (Join-Path $ReleaseRoot '*') $AppDir -Recurse -Force
Push-Location $AppDir
try {
  & npm ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail "npm ci exit code $LASTEXITCODE" }
} finally { Pop-Location }
# UTF-16 so launch.vbs can read paths with non-Latin letters.
Set-Content -Path (Join-Path $AppDir 'installer\node-path.txt') -Value $NodeExe -Encoding Unicode

# 4. Shortcuts
Say 'shortcuts'
$Shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $lnk = $Shell.CreateShortcut((Join-Path $folder 'BewerbungsPilot.lnk'))
  $lnk.TargetPath = $Wscript
  $lnk.Arguments = '"' + $Launcher + '"'
  $lnk.WorkingDirectory = $AppDir
  $lnk.Description = 'BewerbungsPilot'
  $lnk.Save()
}

# 5. Claude sign-in (the one terminal window the user ever sees)
$probe = 'Reply with the word ok.' | & $Claude -p --output-format json --model haiku --no-session-persistence 2>$null | Out-String
$loggedIn = $false
try { $loggedIn = -not ($probe | ConvertFrom-Json).is_error } catch { }
if (-not $loggedIn) {
  Say 'loginNeeded'
  Start-Process -FilePath $Claude
  Read-Host '>' | Out-Null
}

Say 'done'
Start-Process -FilePath $Wscript -ArgumentList ('"' + $Launcher + '"')
