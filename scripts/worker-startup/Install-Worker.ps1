param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z][A-Za-z0-9-]{0,39}$')][string]$Name,
    [Parameter(Mandatory = $true)][string]$Database,
    [string]$PythonExe,
    [string]$PythonVersion = '3.14.3',
    [string]$GitConfig,
    [string]$InstallDirectory
)
$ErrorActionPreference = 'Stop'
if (-not $InstallDirectory) { $InstallDirectory = Join-Path $env:LOCALAPPDATA "Sandcastle\Workers\$Name" }
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
if ($InstallDirectory.StartsWith('\\') -or -not $InstallDirectory.StartsWith(($env:LOCALAPPDATA + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Worker installation must be under current-user LOCALAPPDATA' }
if (-not (Test-Path -LiteralPath $Database -PathType Leaf)) { throw 'Existing canonical database required; no new ledger will be created' }
$Database = (Resolve-Path -LiteralPath $Database).Path
$bundle = Join-Path $PSScriptRoot '..\..\dist\worker-startup\worker.mjs'
if (-not (Test-Path -LiteralPath $bundle -PathType Leaf)) { throw 'First run: node scripts\worker-startup\build.mjs' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$env:NODE_NO_WARNINGS = '1'
$configuration = (& $node $bundle orchestrate workspace list --database $Database) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $configuration.id) { throw 'Canonical workspace configuration could not be validated' }
if ($PythonExe) {
    $PythonExe = (Resolve-Path -LiteralPath $PythonExe).Path
    $GitConfig = (Resolve-Path -LiteralPath $GitConfig).Path
    $version = & $PythonExe -I -c 'import sys; print(sys.version.split()[0])'
    if ($LASTEXITCODE -ne 0 -or $version.Trim() -ne $PythonVersion) { throw 'Selected installed Python version unavailable; no installation attempted' }
}
$taskName = "Sandcastle Worker $Name"
$launcher = Join-Path $InstallDirectory 'Start-Worker.ps1'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '"'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and @($existing.Actions | Where-Object { $_.Arguments -ne $arguments -or $_.Execute -ne $powershell }).Count) { throw 'Existing task belongs to a different action; nothing overwritten' }
[IO.Directory]::CreateDirectory($InstallDirectory) | Out-Null
if ((Get-Item -LiteralPath $InstallDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Worker installation cannot be a reparse point' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$allowed = @($identity.User.Value, 'S-1-5-18', 'S-1-5-32-544')
$icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
& $icacls $InstallDirectory '/inheritance:r' '/grant:r' "*$($identity.User.Value):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Private worker permissions could not be established' }
foreach ($rule in (Get-Acl -LiteralPath $InstallDirectory).Access) {
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -notin $allowed) {
        & $icacls $InstallDirectory '/remove' "*$sid" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Unexpected worker directory access could not be removed' }
    }
}
$lock = $null
try {
    $lock = [IO.File]::Open((Join-Path $InstallDirectory 'supervisor.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    Copy-Item -LiteralPath $bundle -Destination (Join-Path $InstallDirectory 'worker.mjs') -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Start-Worker.ps1') -Destination $InstallDirectory -Force
    $directories = @('node.exe', 'git.exe', 'gh.exe', 'copilot.exe', 'az.cmd') |
        ForEach-Object { Get-Command $_ -ErrorAction SilentlyContinue } |
        ForEach-Object { Split-Path $_.Source -Parent } | Select-Object -Unique
    $stableDirectories = @('Git\cmd', 'GitHub CLI') | ForEach-Object { Join-Path $env:ProgramFiles $_ } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Container }
    @{
        nodeExe = $node; database = $Database; workspaceId = $configuration.id
        pythonExe = $PythonExe; pythonVersion = $PythonVersion; gitConfig = $GitConfig
        executableDirectories = @($stableDirectories) + @($directories)
    } | ConvertTo-Json | Set-Content (Join-Path $InstallDirectory 'launcher.json') -Encoding UTF8
} finally { if ($lock) { $lock.Dispose() } }
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $InstallDirectory
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.User.Value
$principal = New-ScheduledTaskPrincipal -UserId $identity.User.Value -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Canonical orchestration worker. Existing mode/permissions only; no automatic replay of blocked effects. Three crash launches maximum.' -Force | Out-Null
@{
    installedAt = [DateTime]::UtcNow.ToString('o'); taskName = $taskName
    executable = $powershell; arguments = $arguments; workingDirectory = $InstallDirectory
    database = $Database; workspaceId = $configuration.id
    observedRevision = $configuration.revision; observedMode = $configuration.focus.mode
    bundleSha256 = (Get-FileHash (Join-Path $InstallDirectory 'worker.mjs')).Hash
    launcherSha256 = (Get-FileHash $launcher).Hash
    noStoredCredentials = $true; nextActualLogonObserved = $false
} | ConvertTo-Json | Set-Content (Join-Path $InstallDirectory 'installation.json') -Encoding UTF8
Write-Output "Installed $taskName. Canonical configuration unchanged; invoke the registered task to start."
