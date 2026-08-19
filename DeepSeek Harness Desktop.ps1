$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 3080
$url = "http://127.0.0.1:$port/"
$profile = Join-Path $env:LOCALAPPDATA "DeepSeekHarness\desktop-profile"

function Show-DesktopError([string]$message) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($message, "DeepSeek Harness", "OK", "Error") | Out-Null
}

function Get-HarnessProcesses {
  Get-CimInstance Win32_Process | Where-Object {
    $process = $_
    if (-not $process.CommandLine) {
      return $false
    }
    $commandLine = $process.CommandLine
    return (
      ($commandLine.Contains("apps/cli/src/bin.ts") -and
        ($commandLine.Contains(" web ") -or $commandLine.Contains('"web"')) -and
        $commandLine.Contains("--port") -and $commandLine.Contains("3080")) -or
      $commandLine.Contains("pnpm dsh web") -or
      $commandLine.Contains("scripts/dev-web.ts") -or
      $commandLine.Contains("tsconfig.host.json --watch") -or
      $commandLine.Contains("tsdown --env.DSH_BUILD_FACE host --watch") -or
      $commandLine.Contains("DeepSeekHarness\desktop-profile")
    )
  }
}

function Stop-HarnessProcesses {
  $processIds = @(Get-HarnessProcesses | Select-Object -ExpandProperty ProcessId -Unique)
  foreach ($processId in $processIds) {
    & taskkill.exe /PID $processId /T /F 2>$null | Out-Null
  }
}

function Test-WebReady {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    return $client.ConnectAsync("127.0.0.1", $port).Wait(500) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
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
  $ready = Test-WebReady
  if (-not $ready) {
    Stop-HarnessProcesses

    $node = (Get-Command node.exe -ErrorAction Stop).Source
    # Start the source launchers directly so Windows does not orphan or close
    # the nested pnpm.cmd process before the Host begins listening.
    Start-Process -FilePath $node -ArgumentList @("--import", "tsx", "scripts/dev-web.ts", "--poll") -WorkingDirectory $root -WindowStyle Hidden | Out-Null
    Start-Process -FilePath $node -ArgumentList @("--import", "tsx/esm", "apps/cli/src/bin.ts", "web", "--host", "127.0.0.1", "--port", "$port") -WorkingDirectory $root -WindowStyle Hidden | Out-Null

    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    while ([DateTime]::UtcNow -lt $deadline) {
      if (Test-WebReady) {
        $ready = $true
        break
      }
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $ready) {
    throw "The official Web Host did not become ready within 90 seconds. Inspect the dsh web process from the repository root."
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
