param(
    [string]$DashboardDirectory = (Join-Path $env:LOCALAPPDATA 'Sandcastle\Dashboard'),
    [string[]]$Names = @('LLMLab', 'LLMAPI')
)
$ErrorActionPreference = 'Stop'
$DashboardDirectory = [IO.Path]::GetFullPath($DashboardDirectory)
if ($DashboardDirectory.StartsWith('\\') -or -not $DashboardDirectory.StartsWith(($env:LOCALAPPDATA + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Existing current-user LOCALAPPDATA dashboard required' }
if (-not (Test-Path (Join-Path $DashboardDirectory 'installation.json'))) { throw 'Install the read-only dashboard first' }
if ((Get-Item $DashboardDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Dashboard directory cannot be a reparse point' }
$installationPath = Join-Path $DashboardDirectory 'installation.json'
$installation = Get-Content $installationPath -Raw | ConvertFrom-Json
if ($installation.registration -eq 'scheduled-task') {
    $dashboardTask = Get-ScheduledTask -TaskName $installation.taskName -ErrorAction Stop
    if (@($dashboardTask.Actions).Count -ne 1 -or $dashboardTask.Actions.Execute -ne $installation.executable -or $dashboardTask.Actions.Arguments -ne $installation.arguments) { throw 'Registered dashboard action differs from installation; nothing changed' }
} elseif ($installation.registration -eq 'startup-folder') {
    $shell = New-Object -ComObject WScript.Shell
    if (-not (Test-Path -LiteralPath $installation.shortcutPath)) { throw 'Registered dashboard shortcut is missing; nothing changed' }
    $shortcut = $shell.CreateShortcut($installation.shortcutPath)
    if ($shortcut.TargetPath -ne $installation.executable -or $shortcut.Arguments -ne $installation.arguments) { throw 'Registered dashboard shortcut differs from installation; nothing changed' }
} else { throw 'Supported existing dashboard startup registration required' }
$workers = @()
foreach ($name in $Names) {
    if ($name -notmatch '^[A-Za-z][A-Za-z0-9-]{0,39}$') { throw 'Invalid installed worker name' }
    $directory = Join-Path $env:LOCALAPPDATA "Sandcastle\Workers\$name"
    $installed = Get-Content (Join-Path $directory 'installation.json') -Raw | ConvertFrom-Json
    $task = Get-ScheduledTask -TaskName $installed.taskName -ErrorAction Stop
    if ($task.Actions.Execute -ne $installed.executable -or $task.Actions.Arguments -ne $installed.arguments) { throw 'Registered worker action differs from installation; nothing changed' }
    $workers += @{ taskName = $installed.taskName; directory = $directory }
}
if ($workers.Count -eq 0 -or @($workers.taskName | Select-Object -Unique).Count -ne $workers.Count) { throw 'A nonempty unique installed worker list is required' }
$lock = $null
try {
    $lock = [IO.File]::Open((Join-Path $DashboardDirectory 'supervisor.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    Copy-Item (Join-Path $PSScriptRoot 'Watch-Workers.ps1') $DashboardDirectory -Force
    Copy-Item (Join-Path $PSScriptRoot '..\dashboard-startup\Start-Dashboard.ps1') $DashboardDirectory -Force
    @{ workers = $workers } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $DashboardDirectory 'worker-watchdog.json') -Encoding UTF8
    $installation | Add-Member -NotePropertyName launcherSha256 -NotePropertyValue (Get-FileHash (Join-Path $DashboardDirectory 'Start-Dashboard.ps1')).Hash -Force
    $installation | Add-Member -NotePropertyName watchdogInstalledAt -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
    $installation | Add-Member -NotePropertyName scope -NotePropertyValue 'read-only-http-dashboard-and-trusted-worker-watchdog' -Force
    $installation | ConvertTo-Json -Depth 5 | Set-Content $installationPath -Encoding UTF8
} finally { if ($lock) { $lock.Dispose() } }
Write-Output 'Installed dashboard-owned worker watchdog. Start the existing dashboard task; HTTP routes remain read-only.'
