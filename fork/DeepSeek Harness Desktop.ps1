param()

$ErrorActionPreference = 'Stop'

$forkRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $forkRoot
$port = 3081
$stateRoot = Join-Path $env:LOCALAPPDATA 'DeepSeekHarness\desktop-launcher'
$browserProfile = Join-Path $env:LOCALAPPDATA 'DeepSeekHarness\desktop-browser-profile'
$managedNode = Join-Path $env:LOCALAPPDATA 'DeepSeekHarness\runtime\node.exe'
$runId = [Guid]::NewGuid().ToString('N')
$stdoutLog = Join-Path $stateRoot "web-$runId.stdout.log"
$stderrLog = Join-Path $stateRoot "web-$runId.stderr.log"
$readyUrlFile = Join-Path $stateRoot 'ready-url.txt'
$profileName = 'desktop'
$dshHome = Join-Path $env:USERPROFILE '.dsh'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'DeepSeek Harness.lnk'
$launcherPath = $MyInvocation.MyCommand.Path

function Show-DesktopError([string]$message) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    $message,
    'DeepSeek Harness',
    'OK',
    'Error'
  ) | Out-Null
}

function Get-NodePath {
  $candidates = @()
  if ($env:DSH_NODE) { $candidates += $env:DSH_NODE }
  $candidates += $managedNode

  $pathNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($pathNode) { $candidates += $pathNode.Source }

  $candidates += Join-Path $env:USERPROFILE (
    '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  )

  return $candidates |
    Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
    Select-Object -First 1
}

function Assert-LaunchArtifacts {
  $required = @(
    'apps\cli\src\bin.ts',
    'apps\web\dist\index.html',
    'node_modules\tsx\package.json',
    'packages\bundle\web-app\lib\index.js',
    'packages\client\web\lib\index.js',
    'packages\credentials\authorization\lib\index.js',
    'fork\desktop-bundle\cordis.patch.yml',
    'fork\packages\web\web\lib\index.js',
    'fork\packages\web\web-search-pool\lib\index.js',
    'fork\packages\llm\llm-bearer\lib\index.js',
    'fork\packages\client\ui-agent-modes\lib\client.js',
    'fork\packages\client\ui-settings-plugins\lib\client.js',
    'fork\packages\client\ui-settings-models\lib\client.js',
    'fork\packages\llm\llm\lib\typert.host.js',
    'fork\packages\llm\llm\lib\typert.remote-client.js',
    'fork\packages\host\authorization-controller\lib\typert.host.js',
    'fork\packages\host\authorization-controller\lib\typert.remote-client.js',
    'fork\packages\client\ui-authorization\lib\client.js'
  )
  $missing = @(
    $required | Where-Object {
      -not (Test-Path -LiteralPath (Join-Path $root $_) -PathType Leaf)
    }
  )
  if ($missing.Count -gt 0) {
    $missingList = $missing -join "`n- "
    throw "The one-time DeepSeek Harness build is incomplete.`n`nMissing:`n- $missingList`n`nBuild the repository once, then use this shortcut without rebuilding."
  }
}

function Test-PythonCandidate {
  param([string]$Path)

  if (-not $Path) { return $false }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }

  # Prove the candidate instead of judging it by its directory: it must run
  # AND import what the engine needs. Probing the two lazily-imported modules
  # also rejects an interpreter that would start but silently degrade.
  try {
    & $Path -c 'import aiohttp, aiohttp_socks, python_socks' 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Resolve-PythonExecutable {
  $storePrefix = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
  $candidates = [System.Collections.Generic.List[string]]::new()

  foreach ($name in @('python.exe', 'python3.exe')) {
    foreach ($cmd in @(Get-Command $name -CommandType Application -ErrorAction SilentlyContinue)) {
      if ($cmd.Source) { $candidates.Add($cmd.Source) }
    }
  }

  # PATH alone is not enough. Windows ships a Microsoft Store stub that
  # answers to `python` on a machine with no interpreter — it opens the Store
  # instead of running anything, so it is the ONLY thing on PATH here while a
  # perfectly good interpreter sits in an install root PATH never lists.
  # Scanning the usual roots is what keeps the engine from inheriting that
  # stub as its default.
  foreach ($pattern in @(
      (Join-Path $env:LOCALAPPDATA 'Programs\Python\*\python.exe'),
      (Join-Path $env:USERPROFILE '.workbuddy-ai\binaries\python\versions\*\python.exe'),
      'C:\Python*\python.exe'
  )) {
    if (-not $pattern) { continue }
    foreach ($path in @(Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)) {
      $candidates.Add($path)
    }
  }

  foreach ($path in $candidates) {
    # The Store stub is refused on sight: probing it hangs the launch on a
    # Store window rather than returning a nonzero exit.
    if ($storePrefix -and $path.StartsWith($storePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      continue
    }
    if (Test-PythonCandidate $path) { return $path }
  }
  return $null
}

function Ensure-HarvestAgentPreset {
  $source = Join-Path $root 'packages\preset\agent-presets\presets\standard\agent.cordis.yml'
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "The upstream standard agent preset is missing: $source"
  }

  # Harvest replaced `fork-standard` outright, so the generated preset no
  # longer has a sibling to fall back to: drop the stale directory rather
  # than leave a second, unmaintained roster row in the mode picker.
  $legacyRoot = Join-Path $dshHome '.agent-presets\fork-standard'
  if (Test-Path -LiteralPath $legacyRoot) {
    [System.IO.Directory]::Delete($legacyRoot, $true)
  }

  $presetRoot = Join-Path $dshHome '.agent-presets\harvest'
  [System.IO.Directory]::CreateDirectory($presetRoot) | Out-Null
  $presetPath = Join-Path $presetRoot 'agent.cordis.yml'

  $sourceText = [System.IO.File]::ReadAllText($source)
  $forkText = $sourceText.Replace(
    '@deepseek-ai/dsh-compaction-basic',
    '@deepseek-ai/dsh-fork-compaction-basic'
  )

  # Same agent, reframed. The engine appends its own operations manual as a
  # prompt section, so this only has to say what the operator is and that the
  # Python sources under the engine root are ordinary editable code.
  $codingPersona = 'You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.'
  $harvestPersona = 'You are a coding agent powered by the {{model}} model, running DeepSeek Harness in Harvest mode: an OSINT console that discovers and validates third-party API keys. Your working directory is {{cwd}}. The harvest_* tools drive the Python engine; the console shows runs, confirmed hits and logs. The engine''s Python sources under the engine root are ordinary repository code you may read and extend.'
  if (-not $forkText.Contains($codingPersona)) {
    Write-Warning 'Upstream persona text changed; the harvest preset keeps the upstream persona.'
  }
  $forkText = $forkText.Replace($codingPersona, $harvestPersona)

  # Resolve the interpreter at launch instead of trusting whatever `python`
  # means inside the spawned host process.
  $pythonExecutable = Resolve-PythonExecutable
  if ($pythonExecutable) {
    $engineConfig = @"
      config:
        pythonExecutable: '$pythonExecutable'
"@
  } else {
    $engineConfig = ''
    Write-Warning 'No python.exe on PATH; the harvest engine falls back to its built-in default.'
  }

  # A service row in an agent preset MUST sit inside a group carrying an
  # `isolate` realm, or it publishes into the root realm and `dsh-agent-presets`
  # rejects the mount. The engine injects `jobs`, `agents`, `systemPrompt`,
  # `tools` and `webServer` — all host-plane rows that resolve by scope
  # parentage — so `harvestEngine` is the only name this realm has to own.
  $harvestBlock = @'

# ── harvest mode ────────────────────────────────────────────────────────────

- id: harvest
  name: cordis:group
  group: true
  isolate:
    harvestEngine: true
  config:
    - id: harvest-engine
      name: '@deepseek-ai/dsh-fork-harvest-engine'
'@

  $header = @"
# Generated by DeepSeek Harness Desktop from the current upstream standard preset.
# The source is copied at launch so upstream preset changes remain inherited.
# The `harvest` group below is launcher-owned: it mounts the OSINT engine that
# makes this preset Harvest mode.

"@

  $presetText = $header + $forkText.TrimEnd() + "`n`n" + $harvestBlock.TrimStart("`n") + "`n"
  if ($engineConfig -ne '') {
    # TrimEnd/run through to a single trailing newline: the here-string carries
    # its own, and stacking them leaves the file ending mid-config line.
    $presetText = $presetText.TrimEnd() + "`n" + $engineConfig.TrimEnd() + "`n"
  }
  [System.IO.File]::WriteAllText(
    $presetPath,
    $presetText,
    [System.Text.UTF8Encoding]::new($false)
  )

  # Display text for the mode picker. Without it the picker shows the bare id.
  $metadata = @'
name: Harvest
description: OSINT console — harvest_* tools discover and validate third-party API keys.
order: 10
'@
  [System.IO.File]::WriteAllText(
    (Join-Path $presetRoot 'preset.yml'),
    $metadata,
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Ensure-DesktopShortcut {
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($desktopShortcut)
    $shortcut.TargetPath = (Get-Command powershell.exe -ErrorAction Stop).Source
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $launcherPath + '"'
    $shortcut.WorkingDirectory = $root
    $shortcut.Description = 'Start DeepSeek Harness without rebuilding'
    $shortcut.IconLocation = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe,0"
    $shortcut.Save()
  } catch {
    Write-Warning "Could not update the desktop shortcut: $($_.Exception.Message)"
  }
}

function Ensure-PackageJunction([string]$linkPath, [string]$targetRoot) {
  if (Test-Path -LiteralPath $linkPath) {
    $item = Get-Item -LiteralPath $linkPath -Force
    $target = @($item.Target) | Select-Object -First 1
    if (-not $target -or
        -not [System.IO.Path]::GetFullPath($target).Equals(
          [System.IO.Path]::GetFullPath($targetRoot),
          [System.StringComparison]::OrdinalIgnoreCase
        )) {
      [System.IO.Directory]::Delete($linkPath)
    }
  }
  if (-not (Test-Path -LiteralPath $linkPath)) {
    New-Item -ItemType Junction -Path $linkPath -Target $targetRoot | Out-Null
  }
}

function Ensure-DesktopProfile {
  $profileRoot = Join-Path $dshHome "profiles\$profileName"
  $scopeRoot = Join-Path $profileRoot 'node_modules\@deepseek-ai'

  [System.IO.Directory]::CreateDirectory($profileRoot) | Out-Null
  [System.IO.Directory]::CreateDirectory($scopeRoot) | Out-Null

  # A profile resolves packages from its own node_modules. The two Harvest
  # packages need junctions the bundle does not give them: the engine is
  # mounted BY THE PRESET rather than by any bundle row, and the console's
  # bundle row is only linked by the healer after a real `pnpm install`.
  # Pinning both here keeps the composition resolvable without one.
  $links = [ordered]@{
    'dsh-fork-desktop-bundle' = (Join-Path $root 'fork\desktop-bundle')
    'dsh-fork-harvest-engine' = (Join-Path $root 'fork\packages\harvest\engine')
    'dsh-fork-client-ui-harvest' = (Join-Path $root 'fork\packages\harvest\ui-harvest')
  }

  $dependencies = [ordered]@{}
  foreach ($package in $links.Keys) {
    $target = $links[$package]
    Ensure-PackageJunction (Join-Path $scopeRoot $package) $target
    $dependencies['@deepseek-ai/' + $package] = 'link:' + ($target -replace '\\', '/')
  }

  $manifest = [ordered]@{
    name = 'dsh-profile-desktop'
    private = $true
    dependencies = $dependencies
    dsh = [ordered]@{
      profile = [ordered]@{
        bundles = @(
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-web-app',
          '@deepseek-ai/dsh-fork-desktop-bundle'
        )
        patchReload = 'live'
      }
    }
  }
  [System.IO.File]::WriteAllText(
    (Join-Path $profileRoot 'package.json'),
    (($manifest | ConvertTo-Json -Depth 8) + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )
  $cordisPath = Join-Path $profileRoot 'cordis.yml'
  if (-not (Test-Path -LiteralPath $cordisPath)) {
    [System.IO.File]::WriteAllText($cordisPath, "[]`n", [System.Text.UTF8Encoding]::new($false))
  }

  # This profile patch is launcher-owned: it selects the generated preset
  # without touching the upstream preset file or requiring a rebuild.
  # `harvest` is the launcher's only generated preset — Harvest mode replaced
  # `fork-standard`, whose composition was the same standard roster minus the
  # OSINT engine.
  $profilePatch = @"
# Managed by DeepSeek Harness Desktop.
- id: agent-presets
  name: '@deepseek-ai/dsh-agent-presets'
  config:
    default: harvest
"@
  [System.IO.File]::WriteAllText(
    (Join-Path $profileRoot 'cordis.patch.yml'),
    $profilePatch,
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Get-LauncherProcesses {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $line = $_.CommandLine
    $_.Name -eq 'node.exe' -and $line -and
      $line.Contains('apps/cli/src/bin.ts') -and
      $line.Contains('--port') -and
      $line.Contains("$port")
  }
}

function Get-DesktopHostProcesses {
  @(Get-LauncherProcesses | Where-Object {
    $_.CommandLine.Contains('--profile') -and
    $_.CommandLine.Contains($profileName)
  })
}

function Stop-StaleLauncherProcesses {
  $processIds = @(
    Get-LauncherProcesses | Select-Object -ExpandProperty ProcessId -Unique
  )
  foreach ($processId in $processIds) {
    & taskkill.exe /PID $processId /T /F 2>$null | Out-Null
  }
}

function Read-ReadyUrlFromLogFile([string]$path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  $stream = [System.IO.File]::Open(
    $path,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::ReadWrite
  )
  try {
    $reader = [System.IO.StreamReader]::new($stream)
    try { $text = $reader.ReadToEnd() }
    finally { $reader.Dispose() }
  } finally {
    $stream.Dispose()
  }
  $matches = [regex]::Matches($text, 'dsh web:\s+(https?://[^\s]+)')
  if ($matches.Count -eq 0) { return $null }
  return $matches[$matches.Count - 1].Groups[1].Value
}

function Read-ReadyUrlFromLog {
  return Read-ReadyUrlFromLogFile $stdoutLog
}

function Read-LatestReadyUrl {
  $logs = Get-ChildItem -LiteralPath $stateRoot -Filter 'web-*.stdout.log' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending
  foreach ($log in $logs) {
    $candidate = Read-ReadyUrlFromLogFile $log.FullName
    if ($candidate) { return $candidate }
  }
  return $null
}

function Read-SavedReadyUrl {
  if (-not (Test-Path -LiteralPath $readyUrlFile -PathType Leaf)) { return $null }
  $value = [System.IO.File]::ReadAllText($readyUrlFile).Trim()
  if ($value -notmatch '^http://127\.0\.0\.1:\d+/') { return $null }
  return $value
}

function Get-CleanReadyUrl([string]$readyUrl) {
  $uri = [Uri]$readyUrl
  return $uri.GetLeftPart([UriPartial]::Authority) + '/'
}

function Test-WebReady([string]$readyUrl) {
  if (-not $readyUrl) { return $false }
  try {
    $request = [System.Net.HttpWebRequest]::Create($readyUrl)
    $request.Method = 'GET'
    $request.AllowAutoRedirect = $false
    $request.Timeout = 800
    $request.ReadWriteTimeout = 800
    $response = $request.GetResponse()
    try {
      $status = [int]$response.StatusCode
      return ($status -eq 200 -or $status -eq 303)
    }
    finally { $response.Dispose() }
  } catch {
    $exception = $_.Exception
    $response = $null
    while ($exception -and -not $response) {
      $response = $exception.Response
      $exception = $exception.InnerException
    }
    if ($response) { $response.Dispose() }
    return $false
  }
}

function Get-BrowserPath {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  )
  return $candidates |
    Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
    Select-Object -First 1
}

function Open-DesktopWindow([string]$readyUrl) {
  $browser = Get-BrowserPath
  if (-not $browser) {
    Start-Process $readyUrl | Out-Null
    return
  }

  [System.IO.Directory]::CreateDirectory($browserProfile) | Out-Null
  $arguments = @(
    "--app=$readyUrl",
    "--user-data-dir=`"$browserProfile`"",
    '--no-first-run',
    '--no-default-browser-check'
  )
  Start-Process -FilePath $browser -ArgumentList $arguments | Out-Null
}

function Start-HarnessHost([string]$node) {
  [System.IO.Directory]::CreateDirectory($stateRoot) | Out-Null

  $previousDshHome = $env:DSH_HOME
  $env:DSH_HOME = $dshHome
  try {
    return Start-Process -FilePath $node -ArgumentList @(
      '--import', 'tsx/esm',
      'apps/cli/src/bin.ts', '--profile', $profileName,
      '--host', '127.0.0.1',
      '--port', "$port",
      '--no-open'
    ) -WorkingDirectory $root -RedirectStandardOutput $stdoutLog `
      -RedirectStandardError $stderrLog -WindowStyle Hidden -PassThru
  } finally {
    if ($null -eq $previousDshHome) {
      Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue
    } else {
      $env:DSH_HOME = $previousDshHome
    }
  }
}

try {
Assert-LaunchArtifacts
Ensure-HarvestAgentPreset
Ensure-DesktopProfile
Ensure-DesktopShortcut

  $savedReadyUrl = Read-SavedReadyUrl
  if (@(Get-DesktopHostProcesses).Count -gt 0) {
    # ready-url.txt intentionally stores only the clean loopback address. The
    # live dsh web URL carries the session token, so recover it from the
    # stdout log of the already-running host before opening the browser.
    $readyUrl = Read-LatestReadyUrl
    if ($readyUrl -and (Test-WebReady $readyUrl)) {
      Open-DesktopWindow $readyUrl
      exit 0
    }

    # A legacy launcher may have persisted a full URL. Keep that path as a
    # compatibility fallback, but never treat an unauthenticated 401 as ready.
    if ($savedReadyUrl -and $savedReadyUrl.Contains('?') -and (Test-WebReady $savedReadyUrl)) {
      Open-DesktopWindow $savedReadyUrl
      exit 0
    }
  }

  Stop-StaleLauncherProcesses
  $node = Get-NodePath
  if (-not $node) {
    throw 'Node.js 22.19+ or 24+ is required. Install Node.js or set DSH_NODE.'
  }

  $hostProcess = Start-HarnessHost $node
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($hostProcess.HasExited) {
      $details = if (Test-Path -LiteralPath $stderrLog) {
        (Get-Content -LiteralPath $stderrLog -Tail 30) -join "`n"
      } else {
        'No stderr log was created.'
      }
      throw "DeepSeek Harness exited during startup.`n`n$details"
    }

    $readyUrl = Read-ReadyUrlFromLog
    if (Test-WebReady $readyUrl) { break }
    Start-Sleep -Milliseconds 250
  }

  if (-not (Test-WebReady $readyUrl)) {
    throw "DeepSeek Harness did not become ready. Inspect:`n$stderrLog"
  }

  [System.IO.File]::WriteAllText($readyUrlFile, (Get-CleanReadyUrl $readyUrl))
  Open-DesktopWindow $readyUrl
} catch {
  Show-DesktopError $_.Exception.Message
  exit 1
}
