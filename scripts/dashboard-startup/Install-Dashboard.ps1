param(
    [Parameter(Mandatory = $true)][string]$Configuration,
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Sandcastle\Dashboard')
)
$ErrorActionPreference = 'Stop'
$sourceConfig = (Resolve-Path -LiteralPath $Configuration).Path
$bundle = Join-Path $PSScriptRoot '..\..\dist\dashboard-startup\dashboard.mjs'
if (-not (Test-Path -LiteralPath $bundle -PathType Leaf)) { throw 'First run: node scripts\dashboard-startup\build.mjs' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
& $node $bundle $sourceConfig --check-config
if ($LASTEXITCODE -ne 0) { throw 'Dashboard configuration validation failed' }
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
if ($InstallDirectory.StartsWith('\\') -or -not $InstallDirectory.StartsWith(($env:LOCALAPPDATA + '\'), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Install directory must be under current-user LOCALAPPDATA'
}
[IO.Directory]::CreateDirectory($InstallDirectory) | Out-Null
if ((Get-Item -LiteralPath $InstallDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Install directory cannot be a reparse point' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$allowed = @($identity.User.Value, 'S-1-5-18', 'S-1-5-32-544')
$icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
# Change only the DACL; Set-Acl can also request privileged SACL restoration.
& $icacls $InstallDirectory '/inheritance:r' '/grant:r' "*$($identity.User.Value):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Private dashboard directory permissions could not be established' }
foreach ($rule in (Get-Acl -LiteralPath $InstallDirectory).Access) {
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -notin $allowed) {
        & $icacls $InstallDirectory '/remove' "*$sid" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Unexpected dashboard directory access could not be removed' }
    }
}
$lock = $null
try {
    $lock = [IO.File]::Open((Join-Path $InstallDirectory 'supervisor.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    Copy-Item -LiteralPath $bundle -Destination (Join-Path $InstallDirectory 'dashboard.mjs') -Force
    $destinationConfig = Join-Path $InstallDirectory 'dashboard.json'
    if (-not [String]::Equals($sourceConfig, $destinationConfig, [StringComparison]::OrdinalIgnoreCase)) {
        Copy-Item -LiteralPath $sourceConfig -Destination $destinationConfig -Force
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Start-Dashboard.ps1') -Destination $InstallDirectory -Force
    @{ nodeExe = $node } | ConvertTo-Json | Set-Content (Join-Path $InstallDirectory 'launcher.json') -Encoding UTF8
} finally {
    if ($lock) { $lock.Dispose() }
}
$launcher = Join-Path $InstallDirectory 'Start-Dashboard.ps1'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '"'
$taskName = 'Sandcastle Read-only Dashboard'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Sandcastle Dashboard.lnk'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and @($existing.Actions | Where-Object { $_.Arguments -ne $arguments -or $_.Execute -ne $powershell }).Count) {
    throw 'Existing task name belongs to a different action; nothing overwritten'
}
$registration = 'scheduled-task'
try {
    $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $InstallDirectory
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.User.Value
    $principal = New-ScheduledTaskPrincipal -UserId $identity.User.Value -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Current-user read-only loopback dashboard. Optional separately installed trusted worker watchdog; child attempts are bounded.' -Force | Out-Null
} catch {
    if ($existing) { throw }
    $registration = 'startup-folder'
    Write-Warning "Task registration unavailable ($($_.Exception.Message)); using current-user Startup folder, without elevation."
    $shell = New-Object -ComObject WScript.Shell
    if (Test-Path -LiteralPath $shortcutPath) {
        $previous = $shell.CreateShortcut($shortcutPath)
        if ($previous.TargetPath -ne $powershell -or $previous.Arguments -ne $arguments) { throw 'Existing startup shortcut belongs to a different action; nothing overwritten' }
    }
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $powershell
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $InstallDirectory
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Read-only loopback dashboard; optional separately installed trusted worker watchdog'
    $shortcut.Save()
}
@{
    installedAt = [DateTime]::UtcNow.ToString('o')
    registration = $registration
    taskName = if ($registration -eq 'scheduled-task') { $taskName } else { $null }
    shortcutPath = if ($registration -eq 'startup-folder') { $shortcutPath } else { $null }
    executable = $powershell
    arguments = $arguments
    workingDirectory = $InstallDirectory
    userSid = $identity.User.Value
    bundleSha256 = (Get-FileHash (Join-Path $InstallDirectory 'dashboard.mjs') -Algorithm SHA256).Hash
    launcherSha256 = (Get-FileHash $launcher -Algorithm SHA256).Hash
    configurationSource = $sourceConfig
    scope = if (Test-Path (Join-Path $InstallDirectory 'worker-watchdog.json')) { 'read-only-http-dashboard-and-trusted-worker-watchdog' } else { 'read-only-dashboard-only' }
} | ConvertTo-Json | Set-Content (Join-Path $InstallDirectory 'installation.json') -Encoding UTF8
Write-Output "Installed $registration in $InstallDirectory. No agent services started. Invoke the registered task or Startup shortcut to start."
