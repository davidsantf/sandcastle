param([ValidateRange(1, 65535)][int]$Port = 4318)
$ErrorActionPreference = 'Stop'
$directory = $PSScriptRoot
$logDirectory = Join-Path $directory 'logs'
[IO.Directory]::CreateDirectory($logDirectory) | Out-Null
$log = Join-Path $logDirectory 'supervisor.jsonl'
if ((Test-Path $log) -and (Get-Item $log).Length -gt 1MB) {
    Move-Item $log "$log.previous" -Force
}
function Write-Event($eventName, $details) {
    $entry = [ordered]@{ at = [DateTime]::UtcNow.ToString('o'); event = $eventName; supervisorPid = $PID }
    if ($details) { foreach ($key in $details.Keys) { $entry[$key] = $details[$key] } }
    [IO.File]::AppendAllText($log, (($entry | ConvertTo-Json -Compress) + [Environment]::NewLine))
}
$lock = $null
$child = $null
try {
    try {
        $lock = [IO.File]::Open((Join-Path $directory 'supervisor.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    } catch [IO.IOException] {
        if (($_.Exception.HResult -band 0xffff) -notin @(32, 33)) { throw }
        Write-Event 'already-running' @{}
        exit 0
    }
    $settings = Get-Content (Join-Path $directory 'launcher.json') -Raw | ConvertFrom-Json
    if (-not [IO.Path]::IsPathRooted($settings.nodeExe) -or -not (Test-Path -LiteralPath $settings.nodeExe -PathType Leaf)) {
        throw 'Configured Node executable is unavailable'
    }
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        Write-Event 'port-conflict' @{ port = $Port }
        exit 2
    }
    $stop = Join-Path $directory 'stop.request'
    Remove-Item -LiteralPath $stop -Force -ErrorAction SilentlyContinue
    $statePath = Join-Path $directory 'process.json'
    $bundle = Join-Path $directory 'dashboard.mjs'
    $config = Join-Path $directory 'dashboard.json'
    $delays = @(5, 15)
    Get-ChildItem -LiteralPath $logDirectory -File | Where-Object { $_.Name -match '\.(stdout|stderr)\.log$' } |
        Sort-Object Name -Descending | Select-Object -Skip 20 |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
    Write-Event 'supervisor-started' @{ maximumAttempts = 3; port = $Port }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        if (Test-Path -LiteralPath $stop) { Write-Event 'stop-requested' @{}; exit 0 }
        $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff')
        $stdout = Join-Path $logDirectory "$stamp-$attempt.stdout.log"
        $stderr = Join-Path $logDirectory "$stamp-$attempt.stderr.log"
        # Quote fixed file arguments for Windows PowerShell's native command line.
        $arguments = '"' + $bundle + '" "' + $config + '" ' + $Port
        $child = Start-Process -FilePath $settings.nodeExe -ArgumentList $arguments -WorkingDirectory $directory -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $null = $child.Handle
        $state = @{ supervisorPid = $PID; childPid = $child.Id; startedAt = [DateTime]::UtcNow.ToString('o'); attempt = $attempt }
        [IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json))
        Write-Event 'child-started' @{ childPid = $child.Id; attempt = $attempt; stdout = [IO.Path]::GetFileName($stdout); stderr = [IO.Path]::GetFileName($stderr) }
        $ready = $false
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        while (-not $child.WaitForExit(1000)) {
            if (Test-Path -LiteralPath $stop) {
                Write-Event 'stop-requested' @{ childPid = $child.Id }
                $child.Kill()
                $child.WaitForExit()
                exit 0
            }
            if (-not $ready) {
                try {
                    $response = Invoke-RestMethod "http://127.0.0.1:$Port/api/state" -TimeoutSec 3
                    if (-not $response.updatedAt -or -not $response.projects) { throw 'Invalid dashboard response' }
                    $listener = @(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
                    if ($listener.Count -ne 1 -or $listener[0].OwningProcess -ne $child.Id) { throw 'Dashboard listener is not the supervised child' }
                    $ready = $true
                    Write-Event 'ready' @{ childPid = $child.Id; attempt = $attempt; workspaces = @($response.projects).Count }
                } catch {
                    if ([DateTime]::UtcNow -gt $deadline) {
                        Write-Event 'readiness-timeout' @{ childPid = $child.Id; attempt = $attempt }
                        $child.Kill()
                        $child.WaitForExit()
                        break
                    }
                }
            }
        }
        Write-Event 'child-exited' @{ childPid = $child.Id; attempt = $attempt; exitCode = $child.ExitCode; wasReady = $ready }
        $child.Dispose()
        $child = $null
        if (Test-Path -LiteralPath $stop) { Write-Event 'stop-requested' @{}; exit 0 }
        if ($attempt -lt 3) {
            Write-Event 'retry-scheduled' @{ nextAttempt = $attempt + 1; delaySeconds = $delays[$attempt - 1] }
            for ($second = 0; $second -lt $delays[$attempt - 1]; $second++) {
                if (Test-Path -LiteralPath $stop) { Write-Event 'stop-requested' @{}; exit 0 }
                Start-Sleep -Seconds 1
            }
        }
    }
    Write-Event 'attempts-exhausted' @{ attempts = 3; action = 'Inspect logs; manually start again after correcting the failure' }
    exit 1
} catch {
    Write-Event 'supervisor-failed' @{ error = $_.Exception.Message }
    exit 1
} finally {
    if ($child) {
        if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
        $child.Dispose()
    }
    if ($lock) {
        Remove-Item -LiteralPath (Join-Path $directory 'process.json') -Force -ErrorAction SilentlyContinue
        $lock.Dispose()
    }
}
