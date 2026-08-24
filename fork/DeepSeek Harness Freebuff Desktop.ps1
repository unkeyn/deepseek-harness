$ErrorActionPreference = "Stop"

$forkRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $forkRoot
$port = 3081
$url = "http://127.0.0.1:$port/"
$profile = Join-Path $env:LOCALAPPDATA "DeepSeekHarness\freebuff-desktop-profile"
$harnessHome = Join-Path $env:USERPROFILE ".dsh"

function Show-DesktopError([string]$message) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($message, "DeepSeek Harness Freebuff", "OK", "Error") | Out-Null
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

try {
  # Full restart on every launch: stop any running host so stale state never survives.
  Stop-ForkProcesses
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while ([DateTime]::UtcNow -lt $deadline -and @(Get-ForkProcesses).Count -gt 0) {
    Start-Sleep -Milliseconds 200
  }

  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $stdout = Join-Path $harnessHome "profiles\web\freebuff-web.stdout.log"
  $stderr = Join-Path $harnessHome "profiles\web\freebuff-web.stderr.log"
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
    throw "The Freebuff Web Host did not become ready within 90 seconds. Inspect $harnessHome\profiles\web\freebuff-web.stderr.log."
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
