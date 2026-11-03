#Requires -Version 5.1
param(
  [switch]$Unattended,   # the app's "update now": no questions, rollback on failure, status file
  [string]$StatusFile = '',
  [int]$WaitPid = 0
)
$ErrorActionPreference = 'Stop'
$ReleaseRoot = Split-Path -Parent $PSScriptRoot
$AppDir = Join-Path $env:LOCALAPPDATA 'Programs\BewerbungsPilot'
$DataDir = Join-Path $env:LOCALAPPDATA 'BewerbungsPilot'
$Wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$Launcher = Join-Path $AppDir 'installer\launch.vbs'

$Messages = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'messages.json') | ConvertFrom-Json
$Lang = (Get-Culture).TwoLetterISOLanguageName

# Arguments fill {0}, {1}, … in the message (e.g. the real backup folder); without them the text is printed as is.
function Say([string]$Key, [object[]]$Arguments = @()) {
  $fill = { param($text) if ($Arguments.Count -gt 0) { $text -f $Arguments } else { $text } }
  Write-Host (& $fill $Messages.en.$Key)
  if ($Lang -ne 'en' -and ($Messages.PSObject.Properties.Name -contains $Lang)) {
    Write-Host (& $fill $Messages.$Lang.$Key) -ForegroundColor Cyan
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
  # Read and written raw in the registry: [Environment]::SetEnvironmentVariable would expand entries like
  # %USERPROFILE%\... into fixed paths and change the value type for good.
  $envKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  try {
    $userPath = [string]$envKey.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    if (-not (($userPath -split ';') -contains $NodeHome)) {
      $envKey.SetValue('Path', ((@($userPath.TrimEnd(';'), $NodeHome) | Where-Object { $_ }) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
      # Tell Windows the environment changed (a set-and-remove does the broadcast), so new windows see the new Path.
      [Environment]::SetEnvironmentVariable('BP_PATH_REFRESH', '1', 'User')
      [Environment]::SetEnvironmentVariable('BP_PATH_REFRESH', $null, 'User')
    }
  } finally { $envKey.Close() }
}

# Backups before an update (spec 0.9.0, section 3.2): the same zip format the app writes (server/src/backup/format.ts),
# kind "installer", into the app's backup folder. These lists must match format.ts — a test compares them.
$BackupFiles = @('settings.json')
$BackupFolders = @('profile', 'vacancies', 'applications')
$BackupSetAside = '\.(corrupt|invalid)-\d+\.json$'
$BackupMaxEntries = 20000
$BackupMaxBytes = [int64]1024 * 1024 * 1024
function Test-BpInOneDrive([string]$Path) {
  # Same rule as inOneDrive() in server/src/backup/folder.ts — a test runs both on the same paths.
  $norm = { param([string]$p) $p.Replace('/', '\').TrimEnd('\').ToLowerInvariant() }
  $target = & $norm $Path
  foreach ($root in @($env:OneDrive, $env:OneDriveCommercial, $env:OneDriveConsumer)) {
    if (-not $root) { continue }
    $r = & $norm $root
    if ($r -and ($target -eq $r -or $target.StartsWith("$r\", [StringComparison]::Ordinal))) { return $true }
  }
  foreach ($segment in $target.Split('\')) { if ($segment.StartsWith('onedrive', [StringComparison]::Ordinal)) { return $true } }
  return $false
}
function Get-BpBackupDir([string]$DataDir, [string]$Documents) {
  # The same order as resolveBackupFolder() in server/src/backup/folder.ts: BP_BACKUP_DIR, the folder chosen in the
  # app's settings, Documents unless it is synced with OneDrive, else a local folder in the user profile.
  if ($env:BP_BACKUP_DIR) { return [IO.Path]::GetFullPath($env:BP_BACKUP_DIR) }
  try {
    $chosen = (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $DataDir 'settings.json') -ErrorAction Stop | ConvertFrom-Json).backups.folder
    if ($chosen -is [string] -and $chosen -match '^[A-Za-z]:[\\/]') { return [IO.Path]::GetFullPath($chosen) }
  } catch { }
  if (-not $Documents) { $Documents = Join-Path $env:USERPROFILE 'Documents' }
  if (-not (Test-BpInOneDrive $Documents)) { return Join-Path $Documents 'BewerbungsPilot\Backups' }
  return Join-Path $env:USERPROFILE 'BewerbungsPilot\Backups'
}
function Get-InstalledVersion([string]$Dir) {
  # The version of the app being replaced: it wrote the data this backup holds.
  try {
    $v = [string](Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $Dir 'package.json') | ConvertFrom-Json).version
    if ($v -match '^\d+\.\d+\.\d+$') { return $v }
  } catch { }
  return '0.0.0'
}
function New-BpBackup([string]$DataDir, [string]$BackupDir, [string]$AppVersion) {
  Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
  $files = New-Object System.Collections.Generic.List[object]
  # Plain files only; links and junctions are skipped, like the app does.
  $add = {
    param([string]$abs, [string]$name)
    if (-not (Test-Path -LiteralPath $abs)) { return }
    $item = Get-Item -LiteralPath $abs -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { return }
    if ($item.PSIsContainer) {
      foreach ($child in @(Get-ChildItem -LiteralPath $abs -Force | Sort-Object Name)) { & $add $child.FullName "$name/$($child.Name)" }
      return
    }
    if ($name -match $BackupSetAside) { return }
    $files.Add([pscustomobject]@{ Abs = $abs; Name = $name; Size = $item.Length })
  }
  foreach ($f in $BackupFiles) { & $add (Join-Path $DataDir $f) $f }
  foreach ($d in $BackupFolders) { & $add (Join-Path $DataDir $d) $d }
  $total = [int64]0
  foreach ($f in $files) { $total += $f.Size }
  if ($files.Count + 1 -gt $BackupMaxEntries -or $total -gt $BackupMaxBytes) {
    throw "data too large for a backup: $($files.Count) files, $total bytes"
  }

  New-Item -ItemType Directory -Force $BackupDir | Out-Null
  $now = Get-Date
  $base = 'BewerbungsPilot-backup-' + $now.ToString('yyyy-MM-dd-HHmm', [Globalization.CultureInfo]::InvariantCulture)
  $n = 1
  do {
    $zip = Join-Path $BackupDir $(if ($n -eq 1) { "$base.zip" } else { "$base-$n.zip" })
    $n++
  } while ((Test-Path -LiteralPath $zip) -or (Test-Path -LiteralPath "$zip.partial"))
  $partial = "$zip.partial"
  $meta = [ordered]@{
    format = 1; app = 'bewerbungs-pilot'; appVersion = $AppVersion
    createdAt = $now.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
    kind = 'installer'
  }
  # Written as .partial and renamed at the end: a failure never leaves a file that looks like a backup.
  # Entry names use "/" explicitly — Compress-Archive in PowerShell 5.1 writes "\", which the app refuses on restore.
  $ok = $false
  $stream = $null
  try {
    $stream = [IO.File]::Open($partial, [IO.FileMode]::CreateNew)
    $archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create)
    try {
      $w = New-Object IO.StreamWriter($archive.CreateEntry('backup.json').Open(), (New-Object Text.UTF8Encoding($false)))
      try { $w.Write(($meta | ConvertTo-Json)) } finally { $w.Dispose() }
      foreach ($f in $files) {
        $out = $archive.CreateEntry($f.Name, [IO.Compression.CompressionLevel]::Optimal).Open()
        try {
          $in = [IO.File]::Open($f.Abs, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
          try { $in.CopyTo($out) } finally { $in.Dispose() }
        } finally { $out.Dispose() }
      }
    } finally { $archive.Dispose() }
    $stream.Dispose()
    $stream = $null
    Move-Item -LiteralPath $partial -Destination $zip
    $ok = $true
  } finally {
    if ($stream) { $stream.Dispose() }
    if (-not $ok) { Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue }
  }
  return $zip
}
function Get-BpBackupMeta([string]$Zip) {
  # backup.json of one zip, or $null for anything that is not a readable backup.
  Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
  try { $archive = [IO.Compression.ZipFile]::OpenRead($Zip) } catch { return $null }
  try {
    $entry = $archive.GetEntry('backup.json')
    if (-not $entry -or $entry.Length -gt 65536) { return $null }
    $r = New-Object IO.StreamReader($entry.Open(), [Text.Encoding]::UTF8)
    try { return ($r.ReadToEnd() | ConvertFrom-Json) } finally { $r.Dispose() }
  } catch { return $null } finally { $archive.Dispose() }
}
function Remove-OldBpBackups([string]$BackupDir, [int]$Keep = 3) {
  # Only backups the installer made; manual and before-restore copies are the person's and stay.
  if (-not (Test-Path -LiteralPath $BackupDir)) { return }
  $found = @()
  foreach ($z in @(Get-ChildItem -LiteralPath $BackupDir -Filter '*.zip' -File -Force)) {
    $meta = Get-BpBackupMeta $z.FullName
    if (-not $meta -or $meta.kind -ne 'installer') { continue }
    $at = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$meta.createdAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$at)) { continue }
    $found += [pscustomobject]@{ File = $z.FullName; At = $at; Name = $z.Name }
  }
  $found | Sort-Object -Property @{ Expression = 'At'; Descending = $true }, @{ Expression = 'Name'; Descending = $true } |
    Select-Object -Skip $Keep | ForEach-Object { Remove-Item -LiteralPath $_.File -Force }
}

# --- Unattended update (0.11.0, "update now" button): no questions, rollback, status file for the app ---------------
function Invoke-BpRetry([scriptblock]$Action, [int]$Tries, [int]$DelayMs) {
  # Files are briefly held by antivirus scanners, Explorer windows or child processes: try again before giving up.
  for ($i = 1; $i -le $Tries; $i++) {
    try { & $Action | Out-Null; return } catch { if ($i -eq $Tries) { throw }; Start-Sleep -Milliseconds $DelayMs }
  }
}
function Write-BpStatus([string]$File, [string]$State, [string]$Step, [string]$From, [string]$To, [string]$Err) {
  # The running app reads this file. Written next to the target and swapped in, so it never sees half a file;
  # UTF-8 without BOM, which JSON.parse in Node needs.
  $status = [ordered]@{
    state = $State; step = $Step; from = $From; to = $To
    at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
  }
  if ($Err) { $status['error'] = $Err }
  $dir = Split-Path -Parent $File
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $tmp = "$File.tmp"
  $json = $status | ConvertTo-Json
  Invoke-BpRetry -Tries 5 -DelayMs 200 -Action {
    [IO.File]::WriteAllText($tmp, $json, (New-Object Text.UTF8Encoding($false)))
    # .NET Framework's File.Move cannot overwrite, so an existing file is swapped with Replace.
    if (Test-Path -LiteralPath $File) { [IO.File]::Replace($tmp, $File, [NullString]::Value) } else { [IO.File]::Move($tmp, $File) }
  }
}
function Get-BpHealthVersion([int]$Port) {
  # The version the server on this port reports at its open health route, or $null when nothing sensible answers.
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
    if ($r -and $r.app -eq 'bewerbungs-pilot' -and $r.version) { return [string]$r.version }
  } catch { }
  return $null
}
$BpNpmTail = ''
function Invoke-BpNpmCi([string]$Dir) {
  # The exit code; the last lines of npm's output are kept in $BpNpmTail for the status file.
  $script:BpNpmTail = ''
  Push-Location -LiteralPath $Dir
  $saved = $ErrorActionPreference
  try {
    # npm writes progress to stderr; with 'Stop' PowerShell 5.1 would turn that into an exception.
    $ErrorActionPreference = 'Continue'
    $lines = @(& npm ci --omit=dev --no-audit --no-fund 2>&1 | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
    $script:BpNpmTail = (($lines | Select-Object -Last 4) -join ' | ')
    if ($script:BpNpmTail.Length -gt 400) { $script:BpNpmTail = $script:BpNpmTail.Substring(0, 400) }
    return $code
  } finally { $ErrorActionPreference = $saved; Pop-Location }
}
function Start-BpApp([string]$Dir) {
  Start-Process -FilePath $Wscript -ArgumentList ('"' + (Join-Path $Dir 'installer\launch.vbs') + '"')
}
function New-BpShortcuts([string]$Dir) {
  $launcher = Join-Path $Dir 'installer\launch.vbs'
  $shell = New-Object -ComObject WScript.Shell
  foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
    $lnk = $shell.CreateShortcut((Join-Path $folder 'BewerbungsPilot.lnk'))
    $lnk.TargetPath = $Wscript
    $lnk.Arguments = '"' + $launcher + '"'
    $lnk.WorkingDirectory = $Dir
    $lnk.Description = 'BewerbungsPilot'
    $lnk.Save()
  }
}
function Find-BpUpdateNode([string]$AppDir) {
  # The node the installed app actually runs on comes first (launch.vbs reads the same file), then the usual search.
  try {
    $file = Join-Path $AppDir 'installer\node-path.txt'
    if (Test-Path -LiteralPath $file) {
      $exe = (Get-Content -Raw -Encoding Unicode -LiteralPath $file).Trim()
      if ($exe -and (Test-Path -LiteralPath $exe) -and (Test-MinVersion (& $exe -p "process.versions.node"))) { return $exe }
    }
  } catch { }
  return Find-Node
}
function Wait-BpProcessExit([int]$ProcessId, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
}
$BpStopTarget = 0
function Stop-BpOldApp([string]$DataDir, [int]$WaitPid, [int]$WaitSec) {
  # $true when the old server is gone (or was never running). A process we cannot stop makes the update fail.
  $info = $null
  try { $info = Get-Content -Raw -LiteralPath (Join-Path $DataDir 'server.json') -ErrorAction Stop | ConvertFrom-Json } catch { }
  try {
    if ($info -and $info.port) {
      $headers = @{ 'X-BP-Client' = '1' }
      if ($info.key) { $headers['X-BP-Key'] = [string]$info.key }
      Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($info.port)/api/shutdown" -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 3 | Out-Null
    }
  } catch { }
  $target = 0
  if ($WaitPid -gt 0) {
    $target = $WaitPid
  } elseif ($info -and $info.pid -and [int]$info.pid -gt 0) {
    # A stale server.json may name a pid Windows has since given to another program: only a node process counts.
    $p = Get-Process -Id ([int]$info.pid) -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'node') { $target = [int]$info.pid }
  }
  $script:BpStopTarget = $target
  if ($target -le 0) { return $true }
  Wait-BpProcessExit $target $WaitSec
  $proc = Get-Process -Id $target -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq 'node') {
    Stop-Process -Id $target -Force -ErrorAction SilentlyContinue
    Wait-BpProcessExit $target 5
  }
  return -not (Get-Process -Id $target -ErrorAction SilentlyContinue)
}
function Stop-BpNewServer([string]$DataDir, [string]$AppDir) {
  # Rollback: a half-started new server must not keep the folder we are about to delete locked (launch.vbs
  # runs node with the app folder as its current directory). Found by server.json and by its command line,
  # because a server that has not written server.json yet is still holding the folder.
  $pids = New-Object System.Collections.Generic.List[int]
  try {
    $info = Get-Content -Raw -LiteralPath (Join-Path $DataDir 'server.json') -ErrorAction Stop | ConvertFrom-Json
    if ($info.pid -and [int]$info.pid -gt 0) {
      $p = Get-Process -Id ([int]$info.pid) -ErrorAction SilentlyContinue
      if ($p -and $p.ProcessName -eq 'node') { $pids.Add([int]$info.pid) }
    }
  } catch { }
  try {
    $needle = (Join-Path $AppDir 'server\dist\index.js').ToLowerInvariant()
    foreach ($proc in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'")) {
      if ($proc.CommandLine -and $proc.CommandLine.ToLowerInvariant().Contains($needle) -and -not $pids.Contains([int]$proc.ProcessId)) { $pids.Add([int]$proc.ProcessId) }
    }
  } catch { }
  foreach ($id in $pids) {
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    Wait-BpProcessExit $id 5
  }
}
function Invoke-BpUnattendedUpdate {
  # Returns the exit code: 0 done, 1 failed (the old app was started again), 2 rolled back (or the rollback itself failed).
  # The scriptblocks are the parts that touch the outside world; tests replace them.
  param(
    [string]$AppDir, [string]$DataDir, [string]$ReleaseRoot, [string]$StatusFile,
    [int]$WaitPid = 0, [int]$WaitSec = 30, [int]$HealthTimeoutSec = 60, [int]$PollMs = 500,
    [string]$BackupDir = '',
    [scriptblock]$FindNode = { Find-BpUpdateNode $AppDir },
    [scriptblock]$RunNpmCi = { param($dir) Invoke-BpNpmCi $dir },
    [scriptblock]$StartApp = { param($dir) Start-BpApp $dir },
    [scriptblock]$ProbeHealth = { param($port) Get-BpHealthVersion $port },
    [scriptblock]$CreateShortcuts = { param($dir) New-BpShortcuts $dir }
  )
  $previous = "$AppDir.previous"
  $from = '0.0.0'
  $to = '0.0.0'
  $step = 'stopping'
  $report = { param($state, $err) Write-BpStatus -File $StatusFile -State $state -Step $step -From $from -To $to -Err $err }
  # The old app is stopped by now. After a failure that left it intact it must run again: the app that started
  # this installer has exited, so nobody else will.
  $restartOld = { try { if (Test-Path -LiteralPath $AppDir) { & $StartApp $AppDir | Out-Null } } catch { } }
  $fail = { param($why) & $report 'failed' $why; Say 'updateFailed'; & $restartOld }

  try {
    $to = Get-InstalledVersion $ReleaseRoot

    # What the last (interrupted) run left in the status file decides which copy is the good one.
    $prior = $null
    try { $prior = Get-Content -Raw -Encoding UTF8 -LiteralPath $StatusFile -ErrorAction Stop | ConvertFrom-Json } catch { }

    $from = Get-InstalledVersion $AppDir
    & $report 'running' $null
    Say 'updateRunning'

    # 1. Stop the old app.
    if (-not (Stop-BpOldApp -DataDir $DataDir -WaitPid $WaitPid -WaitSec $WaitSec)) {
      & $report 'failed' "the running app (pid $BpStopTarget) did not stop"
      Say 'updateFailed'
      return 1
    }

    # Leftovers of an interrupted update. Resolved only now that the old app is stopped: a failure here restarts the
    # old app, which must not find the dying one still answering.
    try {
      if (-not (Test-Path -LiteralPath $AppDir) -and (Test-Path -LiteralPath $previous)) {
        Move-Item -LiteralPath $previous -Destination $AppDir
      } elseif ((Test-Path -LiteralPath $AppDir) -and (Test-Path -LiteralPath $previous)) {
        $interrupted = $prior -and (
          ($prior.state -eq 'running' -and ($prior.step -eq 'installing' -or $prior.step -eq 'starting')) -or
          ($prior.state -eq 'failed' -and ([string]$prior.error).StartsWith('rollback failed')))
        if ($interrupted) {
          # The new app is half-installed or broken: the old one in .previous is the good copy.
          Invoke-BpRetry -Tries 6 -DelayMs 500 -Action { Remove-Item -LiteralPath $AppDir -Recurse -Force -ErrorAction Stop }
          Move-Item -LiteralPath $previous -Destination $AppDir
        } else {
          Remove-Item -LiteralPath $previous -Recurse -Force
        }
      }
    } catch {
      $from = Get-InstalledVersion $AppDir
      & $fail "could not clean up a previous update: $($_.Exception.Message)"
      return 1
    }
    $from = Get-InstalledVersion $AppDir

    if (-not (Test-Path -LiteralPath (Join-Path $ReleaseRoot 'server\dist\index.js'))) {
      & $fail 'the release folder holds no built app (server\dist\index.js)'
      return 1
    }
    $nodeExe = & $FindNode
    if (-not $nodeExe) {
      & $fail 'Node.js 22.12 or newer was not found (unattended mode does not download it)'
      return 1
    }

    # 2. Backup of the person's data. No backup, no update.
    $step = 'backup'
    & $report 'running' $null
    if (Test-Path -LiteralPath $DataDir) {
      try {
        if (-not $BackupDir) { $BackupDir = Get-BpBackupDir -DataDir $DataDir -Documents ([Environment]::GetFolderPath('MyDocuments')) }
        New-BpBackup -DataDir $DataDir -BackupDir $BackupDir -AppVersion $from | Out-Null
      } catch {
        & $fail "backup failed: $($_.Exception.Message)"
        return 1
      }
      try { Remove-OldBpBackups -BackupDir $BackupDir -Keep 3 } catch { }
    }

    # 3. Install next to the old app, which is only renamed until the new one answers.
    $step = 'installing'
    & $report 'running' $null
    $hadApp = Test-Path -LiteralPath $AppDir
    try {
      if ($hadApp) { Invoke-BpRetry -Tries 10 -DelayMs 500 -Action { Move-Item -LiteralPath $AppDir -Destination $previous -ErrorAction Stop } }
    } catch {
      & $fail "could not move the old app aside: $($_.Exception.Message)"
      return 1
    }

    $problem = $null
    try {
      New-Item -ItemType Directory -Force $AppDir | Out-Null
      # Literal paths: a user name with [ ] would make a wildcard copy match nothing.
      Get-ChildItem -LiteralPath $ReleaseRoot -Force | Copy-Item -Destination $AppDir -Recurse -Force
      $npmExit = & $RunNpmCi $AppDir
      if ($npmExit -ne 0) { throw "npm ci exit code $npmExit $BpNpmTail".Trim() }
      # UTF-16 so launch.vbs can read paths with non-Latin letters.
      Set-Content -LiteralPath (Join-Path $AppDir 'installer\node-path.txt') -Value $nodeExe -Encoding Unicode
      # Shortcuts point to the same path as before: failing to write them is no reason to undo the update.
      try { & $CreateShortcuts $AppDir | Out-Null } catch { }

      # 4. Start it and wait until it really answers with the new version.
      $step = 'starting'
      & $report 'running' $null
      # An old server.json would name the old port and pid.
      Remove-Item -LiteralPath (Join-Path $DataDir 'server.json') -Force -ErrorAction SilentlyContinue
      & $StartApp $AppDir | Out-Null
      $answered = $false
      $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
      do {
        try {
          $info = Get-Content -Raw -LiteralPath (Join-Path $DataDir 'server.json') -ErrorAction Stop | ConvertFrom-Json
          if ($info.port) { $answered = ([string](& $ProbeHealth ([int]$info.port)) -eq $to) }
        } catch { }
        if (-not $answered) { Start-Sleep -Milliseconds $PollMs }
      } while (-not $answered -and (Get-Date) -lt $deadline)
      if (-not $answered) { throw "the new app did not answer /api/health with version $to within $HealthTimeoutSec s" }
    } catch {
      $problem = $_.Exception.Message
    }

    if (-not $problem) {
      if ($hadApp) { try { Remove-Item -LiteralPath $previous -Recurse -Force } catch { } }   # a leftover is cleaned at the next start
      # The update is done; a status file that cannot be written must not turn that into a failure.
      try { & $report 'done' $null } catch { }
      Say 'updateDone'
      return 0
    }

    # Rollback: the old app comes back exactly as it was.
    try {
      Stop-BpNewServer $DataDir $AppDir
      if (Test-Path -LiteralPath $AppDir) {
        Invoke-BpRetry -Tries 6 -DelayMs 500 -Action { Remove-Item -LiteralPath $AppDir -Recurse -Force -ErrorAction Stop }
      }
      if ($hadApp) { Move-Item -LiteralPath $previous -Destination $AppDir }
      Remove-Item -LiteralPath (Join-Path $DataDir 'server.json') -Force -ErrorAction SilentlyContinue
      if ($hadApp) { & $StartApp $AppDir | Out-Null }
    } catch {
      # "rollback failed" is what the next run looks for to restore .previous.
      try { & $report 'failed' "rollback failed: $($_.Exception.Message) (update problem: $problem)" } catch { }
      Say 'updateRollbackFailed'
      return 2
    }
    try { & $report 'rolledBack' $problem } catch { }
    Say 'updateRolledBack'
    return 2
  } catch {
    # Anything unforeseen: the status must still end in a final state, and the old app should run again.
    try { & $report 'failed' "unexpected: $($_.Exception.Message)" } catch { }
    Say 'updateFailed'
    & $restartOld
    return 1
  }
}

# Everything below acts. Dot-sourcing the script (tests: `. .\install.ps1`) only loads the functions above.
if ($MyInvocation.InvocationName -ne '.') {
  if ($Unattended) {
    if (-not $StatusFile) { $StatusFile = Join-Path $DataDir 'update-status.json' }
    $findNode = {
      $n = Find-BpUpdateNode $AppDir
      # npm below must be the one that belongs to this node.
      if ($n) { $env:Path = (Split-Path -Parent $n) + ';' + $env:Path }
      $n
    }
    $code = @(Invoke-BpUnattendedUpdate -AppDir $AppDir -DataDir $DataDir -ReleaseRoot $ReleaseRoot -StatusFile $StatusFile -WaitPid $WaitPid -FindNode $findNode)[-1]
    exit $code
  }
  Say 'title'

  # The source code from GitHub ("Code" > "Download ZIP") has no built app in it.
  if (-not (Test-Path (Join-Path $ReleaseRoot 'server\dist\index.js'))) { Say 'sourceCode'; exit 1 }

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
    try { $info = Get-Content -Raw -LiteralPath $ServerJson | ConvertFrom-Json } catch { }
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
  # 3b. Back up the person's data before anything is replaced (spec 0.9.0, 3.2). The three newest installer backups
  # are kept; if the backup fails we ask instead of silently risking the data.
  if (Test-Path -LiteralPath $DataDir) {
    $BackupDir = Get-BpBackupDir -DataDir $DataDir -Documents ([Environment]::GetFolderPath('MyDocuments'))
    Say 'backingUp' @($BackupDir)
    $backup = $null
    try {
      $backup = New-BpBackup -DataDir $DataDir -BackupDir $BackupDir -AppVersion (Get-InstalledVersion $AppDir)
    } catch {
      Say 'backupFailed'
      Write-Host $_.Exception.Message -ForegroundColor Red
    }
    if ($backup) {
      Write-Host $backup
      try { Remove-OldBpBackups -BackupDir $BackupDir -Keep 3 } catch { Write-Host $_.Exception.Message -ForegroundColor Yellow }
    } elseif (-not (Ask 'continueWithoutBackup')) {
      Say 'nothingChanged'
      exit 1
    }
  }
  Say 'copying'
  if (Test-Path -LiteralPath $AppDir) { Remove-Item -LiteralPath $AppDir -Recurse -Force }
  New-Item -ItemType Directory -Force $AppDir | Out-Null
  Get-ChildItem -LiteralPath $ReleaseRoot -Force | Copy-Item -Destination $AppDir -Recurse -Force
  Push-Location -LiteralPath $AppDir
  try {
    & npm ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Fail "npm ci exit code $LASTEXITCODE" }
  } finally { Pop-Location }
  # UTF-16 so launch.vbs can read paths with non-Latin letters.
  Set-Content -LiteralPath (Join-Path $AppDir 'installer\node-path.txt') -Value $NodeExe -Encoding Unicode
  # A leftover of an earlier one-click update is of no use now (best effort).
  if (Test-Path -LiteralPath "$AppDir.previous") { try { Remove-Item -LiteralPath "$AppDir.previous" -Recurse -Force } catch { } }

  # 4. Shortcuts
  Say 'shortcuts'
  New-BpShortcuts $AppDir

  Say 'done'
  Start-Process -FilePath $Wscript -ArgumentList ('"' + $Launcher + '"')
}
