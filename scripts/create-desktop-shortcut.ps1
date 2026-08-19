$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$desktop = [Environment]::GetFolderPath("Desktop")
$oldShortcut = Join-Path $desktop "DeepSeek Harness Headless.lnk"
$shortcutPath = Join-Path $desktop "DeepSeek Harness Desktop.lnk"
$scriptPath = Join-Path $root "DeepSeek Harness Desktop.ps1"
$powershellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

if (Test-Path -LiteralPath $oldShortcut) {
  Remove-Item -LiteralPath $oldShortcut -Force
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellPath
$shortcut.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""
$shortcut.WorkingDirectory = $root
$shortcut.Description = "Open DeepSeek Harness as a standalone desktop window"
$shortcut.IconLocation = "$(Join-Path $env:SystemRoot "System32\shell32.dll"),220"
$shortcut.Save()

Write-Output "Created: $shortcutPath"
