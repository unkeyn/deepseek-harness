$ErrorActionPreference = "Stop"

$forkRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $forkRoot
$port = 3081
$url = "http://127.0.0.1:$port/"
$profile = Join-Path $env:LOCALAPPDATA "DeepSeekHarness\freebuff-desktop-profile"
$harnessHome = Join-Path $env:USERPROFILE ".dsh"

function Show-DesktopError([string]$message) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($message, "DeepSeek Harness Desktop", "OK", "Error") | Out-Null
}

function Get-ForkProcesses {
  Get-CimInstance Win32_Process | Where-Object {
    $line = $_.CommandLine
    # Match both launch modes: the built CLI (apps/cli/lib/bin.js) this script
    # starts and a source launch (apps/cli/src/bin.ts) a dev session may have
    # left behind. Either way a process holding the port must die before a new
    # one binds, or the browser would open against the stale host.
    $line -and $line.Contains("apps/cli") -and $line.Contains("bin.") -and $line.Contains("--port") -and $line.Contains("$port")
  }
}

function Stop-ForkProcesses {
  $processIds = @(Get-ForkProcesses | Select-Object -ExpandProperty ProcessId -Unique)
  foreach ($processId in $processIds) {
    & taskkill.exe /PID $processId /T /F 2>$null | Out-Null
  }
}

function Test-WebReady {
  $request = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$port/freebuff/freebuff.status")
  $request.Method = "POST"
  $request.ContentType = "application/json"
  $request.Accept = "application/json"
  $request.Timeout = 400
  $request.ReadWriteTimeout = 400
  try {
    $body = '{"type":"client-request","rpcId":"launcher-health","method":"freebuff.status","payload":{}}'
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $request.ContentLength = $bytes.Length
    $stream = $request.GetRequestStream()
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    $response = $request.GetResponse()
    try { return ([int]$response.StatusCode -eq 200) } finally { $response.Dispose() }
  } catch {
    return $false
  }
}

function Get-BrowserPath {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
  )
  return $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}

function Get-ForkSourceNewest {
  # Newest mtime across the fork's own sources (package src trees never contain
  # node_modules, so the plain recursive scan stays cheap and junction-safe).
  $newest = [DateTime]::MinValue
  $packages = Join-Path $forkRoot "packages"
  foreach ($group in Get-ChildItem -LiteralPath $packages -Directory -ErrorAction SilentlyContinue) {
    foreach ($pkg in Get-ChildItem -LiteralPath $group.FullName -Directory -ErrorAction SilentlyContinue) {
      $src = Join-Path $pkg.FullName "src"
      if (-not (Test-Path -LiteralPath $src)) { continue }
      $latest = Get-ChildItem -LiteralPath $src -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
      if ($latest -and $latest.LastWriteTimeUtc -gt $newest) { $newest = $latest.LastWriteTimeUtc }
    }
  }
  $bundle = Join-Path $forkRoot "bundle"
  if (Test-Path -LiteralPath $bundle) {
    $latest = Get-ChildItem -LiteralPath $bundle -Recurse -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if ($latest -and $latest.LastWriteTimeUtc -gt $newest) { $newest = $latest.LastWriteTimeUtc }
  }
  return $newest
}

function Update-ForkBuild {
  # Rebuild the fork overlay whenever its sources are newer than the last
  # successful build, so the desktop host never serves stale plugin code.
  $stamp = Join-Path $forkRoot ".build-stamp"
  $stampTime = [DateTime]::MinValue
  if (Test-Path -LiteralPath $stamp) { $stampTime = (Get-Item -LiteralPath $stamp).LastWriteTimeUtc }
  if ((Get-ForkSourceNewest) -le $stampTime) { return }
  $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($null -eq $pnpm) { throw "pnpm is required to rebuild the fork overlay before launch." }
  $buildLog = Join-Path $harnessHome "profiles\web\desktop-build.log"
  New-Item -ItemType Directory -Path (Split-Path -Parent $buildLog) -Force | Out-Null
  Push-Location $forkRoot
  try {
    & $pnpm.Source run build:lib *> $buildLog
  } finally {
    Pop-Location
  }
  if ($LASTEXITCODE -ne 0) {
    throw "The fork overlay build failed; the stale build was NOT started. Inspect $buildLog"
  }
  New-Item -ItemType File -LiteralPath $stamp -Force | Out-Null
}

try {
  # Full restart on every launch: stop any running host so stale state never survives.
  Stop-ForkProcesses
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while ([DateTime]::UtcNow -lt $deadline -and @(Get-ForkProcesses).Count -gt 0) {
    Start-Sleep -Milliseconds 200
  }

  Update-ForkBuild

  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $stdout = Join-Path $harnessHome "profiles\web\desktop-web.stdout.log"
  $stderr = Join-Path $harnessHome "profiles\web\desktop-web.stderr.log"
  New-Item -ItemType Directory -Path (Split-Path -Parent $stdout) -Force | Out-Null
  $previousDshHome = $env:DSH_HOME
  $env:DSH_HOME = $harnessHome
  try {
    Start-Process -FilePath $node -ArgumentList @(
      "apps/cli/lib/bin.js", "web",
      "--host", "127.0.0.1", "--port", "$port", "--no-open"
    ) -WorkingDirectory $root `
      -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden | Out-Null
  } finally {
    if ($previousDshHome -eq $null) { Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue }
    else { $env:DSH_HOME = $previousDshHome }
  }

  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-WebReady) {
      break
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-WebReady)) {
    throw "The Harness Web Host did not become ready within 90 seconds. Inspect $harnessHome\profiles\web\desktop-web.stderr.log."
  }

  $browser = Get-BrowserPath
  if (-not $browser) {
    throw "Microsoft Edge or Google Chrome is required for the standalone desktop window."
  }

  New-Item -ItemType Directory -Path $profile -Force | Out-Null
  $browserArguments = "--app=`"$url`" --user-data-dir=`"$profile`" --no-first-run --no-default-browser-check"
  Start-Process -FilePath $browser -ArgumentList $browserArguments | Out-Null
} catch {
  Show-DesktopError $_.Exception.Message
  exit 1
}
