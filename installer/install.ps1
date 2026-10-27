#Requires -Version 5.1
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

# Everything below acts. Dot-sourcing the script (tests: `. .\install.ps1`) only loads the functions above.
if ($MyInvocation.InvocationName -ne '.') {
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
}
