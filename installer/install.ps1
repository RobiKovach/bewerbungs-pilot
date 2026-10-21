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

Say 'title'

# The source code from GitHub ("Code" > "Download ZIP") has no built app in it.
if (-not (Test-Path (Join-Path $ReleaseRoot 'server\dist\index.js'))) { Say 'sourceCode'; exit 1 }

# 1. Node.js >= 22.12 (Google sign-in, PDF making and PDF reading need it).
# Without a suitable one we put the official zip into the user's own folder: no administrator rights needed
# (work and school PCs often have none), the same Node.js the .msi would install.
$NodeHome = Join-Path $env:LOCALAPPDATA 'Programs\BewerbungsPilot-Node'
function Test-MinVersion([string]$Version) {
  $v = $Version.Trim().TrimStart('v').Split('.')
  return ([int]$v[0] -gt 22) -or (([int]$v[0] -eq 22) -and ([int]$v[1] -ge 12))
}
function Find-Node {
  $candidates = @()
  $onPath = Get-Command node -ErrorAction SilentlyContinue
  if ($onPath) { $candidates += $onPath.Source }
  $candidates += (Join-Path $NodeHome 'node.exe')
  foreach ($exe in $candidates) {
    if (-not (Test-Path $exe)) { continue }
    try { if (Test-MinVersion (& $exe -p "process.versions.node")) { return $exe } } catch { }
  }
  return $null
}
function Install-PortableNode {
  $ProgressPreference = 'SilentlyContinue'   # the progress bar makes downloads many times slower in PowerShell 5.1
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $dist = 'https://nodejs.org/dist'
  # The newest LTS that has been out for 14 days: a broken or hijacked release is usually caught in the first days.
  $cutoff = (Get-Date).AddDays(-14)
  # Into a variable first: PowerShell 5.1 passes a JSON array down a pipe as one object.
  $index = Invoke-RestMethod "$dist/index.json" -UseBasicParsing
  $release = $index |
    Where-Object { $_.lts -and ($_.files -contains "win-$arch-zip") -and ([datetime]$_.date -le $cutoff) -and (Test-MinVersion $_.version) } |
    Select-Object -First 1
  if (-not $release) { throw 'no suitable Node.js LTS release in index.json' }
  $name = "node-$($release.version)-win-$arch"
  # Same drive as $NodeHome, so the folder can be moved in one step; a short name, because npm inside the zip
  # has deep paths and Windows PowerShell stops at 260 characters.
  $tmp = Join-Path $env:LOCALAPPDATA ('Programs\bpn-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force $tmp | Out-Null
  try {
    $zip = Join-Path $tmp "$name.zip"
    Invoke-WebRequest "$dist/$($release.version)/$name.zip" -OutFile $zip -UseBasicParsing
    $sums = (Invoke-WebRequest "$dist/$($release.version)/SHASUMS256.txt" -UseBasicParsing).Content
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::ASCII.GetString($sums) }
    $match = [regex]::Match($sums, '(?m)^([0-9a-f]{64})\s+' + [regex]::Escape("$name.zip") + '\s*$')
    if (-not $match.Success) { throw "no checksum for $name.zip" }
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $match.Groups[1].Value) { throw "checksum mismatch for $name.zip" }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $tmp)
    if (Test-Path $NodeHome) { Remove-Item $NodeHome -Recurse -Force }
    Move-Item (Join-Path $tmp $name) $NodeHome
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
  # The user's own Path (no administrator rights): new windows find node, npm and the AI helpers installed with it.
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (($userPath -split ';') -contains $NodeHome)) {
    [Environment]::SetEnvironmentVariable('Path', ((@($userPath, $NodeHome) | Where-Object { $_ }) -join ';'), 'User')
  }
}
Say 'checkingNode'
$NodeExe = Find-Node
if (-not $NodeExe) {
  if (-not (Ask 'nodeMissing')) { Say 'aborted'; exit 1 }
  Say 'downloadingNode'
  try { Install-PortableNode } catch { Say 'nodeInstallFailed'; Fail $_.Exception.Message }
  $NodeExe = Find-Node
  if (-not $NodeExe) { Say 'nodeInstallFailed'; Fail 'node not found after installation' }
}
# npm below must be the one that belongs to this node.
$env:Path = (Split-Path -Parent $NodeExe) + ';' + $env:Path

# 2. A browser for PDFs (Edge or Chrome). Only a warning: everything else works without it.
Say 'checkingBrowser'
$browserPaths = @()
foreach ($base in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) {
  if ($base) {
    $browserPaths += (Join-Path $base 'Microsoft\Edge\Application\msedge.exe')
    $browserPaths += (Join-Path $base 'Google\Chrome\Application\chrome.exe')
  }
}
if ($env:LOCALAPPDATA) { $browserPaths += (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe') }
if (-not ($browserPaths | Where-Object { Test-Path $_ })) { Say 'browserMissing' }

# 3. Stop a running copy (update case), then copy the app. User data in $DataDir is never touched.
$ServerJson = Join-Path $DataDir 'server.json'
if (Test-Path $ServerJson) {
  $info = $null
  try { $info = Get-Content -Raw $ServerJson | ConvertFrom-Json } catch { }
  try {
    if ($info -and $info.port) {
      # Since 0.8.3 the server only accepts requests carrying this launch's key; older servers wrote none.
      $headers = @{ 'X-BP-Client' = '1' }
      if ($info.key) { $headers['X-BP-Key'] = [string]$info.key }
      Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($info.port)/api/shutdown" -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 3 | Out-Null
    }
  } catch { }
  # Wait (max. 15 s) until the old server process has really exited, so its files are no longer in use.
  # Still alive (e.g. it refused the request): stop it and wait max. 5 s more. Only a node process is stopped —
  # a stale server.json may name a pid Windows has since given to another program.
  try {
    if ($info -and $info.pid) {
      $deadline = (Get-Date).AddSeconds(15)
      while ((Get-Process -Id $info.pid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 250
      }
      $proc = Get-Process -Id $info.pid -ErrorAction SilentlyContinue
      if ($proc -and $proc.ProcessName -eq 'node') {
        Stop-Process -Id $info.pid -Force -ErrorAction SilentlyContinue
        $deadline = (Get-Date).AddSeconds(5)
        while ((Get-Process -Id $info.pid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
          Start-Sleep -Milliseconds 250
        }
      }
    }
  } catch { }
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

Say 'done'
Start-Process -FilePath $Wscript -ArgumentList ('"' + $Launcher + '"')
