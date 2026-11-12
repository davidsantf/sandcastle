param([switch]$Once)
$ErrorActionPreference = 'Stop'
$directory = $PSScriptRoot
$log = Join-Path $directory 'logs\worker-watchdog.jsonl'
$statePath = Join-Path $directory 'worker-watchdog-state.json'
$lock = $null
function Write-Event($name, $details) {
    $entry = [ordered]@{ at = [DateTime]::UtcNow.ToString('o'); event = $name; watchdogPid = $PID }
    foreach ($key in $details.Keys) { $entry[$key] = $details[$key] }
    [IO.File]::AppendAllText($log, (($entry | ConvertTo-Json -Compress) + [Environment]::NewLine))
}
function Read-Status($workerDirectory, $settings) {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $settings.nodeExe
    $info.Arguments = '"' + (Join-Path $workerDirectory 'worker.mjs') + '" orchestrate workspace status --database "' + $settings.database + '"'
    $info.WorkingDirectory = $workerDirectory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.EnvironmentVariables['NODE_NO_WARNINGS'] = '1'
    $process = [Diagnostics.Process]::Start($info)
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(15000)) { $process.Kill(); $process.WaitForExit(); throw 'control-timeout' }
        if ($process.ExitCode -ne 0) { throw 'control-unconfirmed' }
        return ($stdout.GetAwaiter().GetResult() | ConvertFrom-Json)
    } finally { $process.Dispose() }
}
function Save-State {
    $state.updatedAt = [DateTime]::UtcNow.ToString('o')
    $temporary = "$statePath.$PID.tmp"
    [IO.File]::WriteAllText($temporary, ($state | ConvertTo-Json -Depth 6))
    if (Test-Path -LiteralPath $statePath) { [IO.File]::Replace($temporary, $statePath, "$statePath.previous") }
    else { [IO.File]::Move($temporary, $statePath) }
}
try {
    [IO.Directory]::CreateDirectory((Join-Path $directory 'logs')) | Out-Null
    try { $lock = [IO.File]::Open((Join-Path $directory 'worker-watchdog.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch [IO.IOException] {
        if (($_.Exception.HResult -band 0xffff) -notin @(32, 33)) { throw }
        exit 0
    }
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 1MB) { Move-Item $log "$log.previous" -Force }
    $configuration = Get-Content (Join-Path $directory 'worker-watchdog.json') -Raw | ConvertFrom-Json
    $state = if (Test-Path -LiteralPath $statePath) { Get-Content $statePath -Raw | ConvertFrom-Json } else { [pscustomobject]@{ updatedAt = ''; workers = @() } }
    foreach ($worker in $configuration.workers) {
        if (-not @($state.workers | Where-Object { $_.taskName -eq $worker.taskName }).Count) {
            $state.workers += [pscustomobject]@{ taskName = $worker.taskName; starts = 0; lastAttemptAt = $null; status = 'unchecked' }
        }
    }
    Write-Event 'watchdog-started' @{ maximumTaskRestarts = 3; intervalSeconds = 30 }
    do {
        if (Test-Path (Join-Path $directory 'worker-watchdog.stop.request')) { Write-Event 'watchdog-stopped' @{}; break }
        foreach ($worker in $configuration.workers) {
            $entry = $state.workers | Where-Object { $_.taskName -eq $worker.taskName }
            $previous = $entry.status
            try {
                $task = Get-ScheduledTask -TaskName $worker.taskName -ErrorAction Stop
                $installed = Get-Content (Join-Path $worker.directory 'installation.json') -Raw | ConvertFrom-Json
                $settings = Get-Content (Join-Path $worker.directory 'launcher.json') -Raw | ConvertFrom-Json
                if ($task.Actions.Execute -ne $installed.executable -or $task.Actions.Arguments -ne $installed.arguments) { throw 'task-action-changed' }
                if ((Test-Path (Join-Path $directory 'worker-watchdog.disabled')) -or
                    (Test-Path (Join-Path $worker.directory 'watchdog.disabled')) -or
                    (Test-Path (Join-Path $worker.directory 'stop.request')) -or $task.State.ToString() -eq 'Disabled') {
                    $entry.status = 'intentionally-disabled-or-stopped'
                } else {
                    $status = Read-Status $worker.directory $settings
                    if ($status.service) {
                        $entry.status = "owner-$($status.service.state)"
                    } elseif ($status.owner -eq 'released') {
                        $entry.status = 'released-no-automatic-resume'
                    } elseif ($status.owner -ne 'dead') {
                        $entry.status = 'owner-unconfirmed-no-restart'
                    } elseif ($task.State.ToString() -eq 'Running') {
                        $entry.status = 'worker-supervisor-handling-recovery'
                    } else {
                        $history = Join-Path $worker.directory 'logs\supervisor.jsonl'
                        $last = if (Test-Path $history) { Get-Content $history -Tail 1 | ConvertFrom-Json } else { $null }
                        if ($last -and $last.event -in @('worker-blocked', 'attempts-exhausted', 'stopped', 'stop-requested', 'supervisor-failed', 'owner-present-or-unconfirmed', 'child-settlement-required')) {
                            $entry.status = 'held-for-inspection-no-restart'
                        } elseif ($entry.starts -ge 3) {
                            $entry.status = 'watchdog-restarts-exhausted'
                        } elseif ($entry.lastAttemptAt -and ([DateTime]::UtcNow - [DateTime]::Parse($entry.lastAttemptAt).ToUniversalTime()).TotalSeconds -lt @(30, 60, 120)[$entry.starts]) {
                            $entry.status = 'restart-backoff'
                        } else {
                            # Recheck at the mutation boundary; native journal acquisition is the final fence.
                            $verified = Read-Status $worker.directory $settings
                            $latestTask = Get-ScheduledTask -TaskName $worker.taskName -ErrorAction Stop
                            if ($verified.owner -ne 'dead' -or $latestTask.State.ToString() -in @('Running', 'Disabled') -or
                                $latestTask.Actions.Execute -ne $installed.executable -or $latestTask.Actions.Arguments -ne $installed.arguments -or
                                (Test-Path (Join-Path $worker.directory 'stop.request')) -or
                                (Test-Path (Join-Path $worker.directory 'watchdog.disabled')) -or
                                (Test-Path (Join-Path $directory 'worker-watchdog.disabled')) -or
                                (Test-Path (Join-Path $directory 'worker-watchdog.stop.request'))) {
                                $entry.status = 'restart-fence-changed'
                            } else {
                                $entry.starts++
                                $entry.lastAttemptAt = [DateTime]::UtcNow.ToString('o')
                                $entry.status = 'task-start-reserved'
                                Save-State
                                Start-ScheduledTask -TaskName $worker.taskName -ErrorAction Stop
                                $entry.status = 'task-restart-requested'
                                Write-Event 'task-restart-requested' @{ taskName = $worker.taskName; count = $entry.starts }
                            }
                        }
                    }
                }
            } catch {
                $entry.status = 'control-or-registration-unconfirmed-no-restart'
            }
            if ($entry.status -ne $previous) { Write-Event 'worker-status' @{ taskName = $worker.taskName; status = $entry.status; restarts = $entry.starts } }
            Save-State
        }
        if (-not $Once) {
            for ($second = 0; $second -lt 30; $second++) {
                if (Test-Path (Join-Path $directory 'worker-watchdog.stop.request')) { break }
                Start-Sleep -Seconds 1
            }
        }
    } while (-not $Once)
} catch {
    Write-Event 'watchdog-failed' @{ action = 'Inspect trusted registration/configuration/state; no raw subprocess errors retained' }
    exit 1
} finally { if ($lock) { $lock.Dispose() } }
