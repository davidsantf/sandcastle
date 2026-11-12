$ErrorActionPreference = 'Stop'
$directory = $PSScriptRoot
$logDirectory = Join-Path $directory 'logs'
[IO.Directory]::CreateDirectory($logDirectory) | Out-Null
$log = Join-Path $logDirectory 'supervisor.jsonl'
function Write-Event($name, $details) {
    $entry = [ordered]@{ at = [DateTime]::UtcNow.ToString('o'); event = $name; supervisorPid = $PID }
    if ($details) { foreach ($key in $details.Keys) { $entry[$key] = $details[$key] } }
    [IO.File]::AppendAllText($log, (($entry | ConvertTo-Json -Compress) + [Environment]::NewLine))
}
function Invoke-Control($action) {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $settings.nodeExe
    $info.Arguments = '"' + $bundle + '" orchestrate workspace ' + $action + ' --database "' + $settings.database + '"'
    $info.WorkingDirectory = $directory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = [Diagnostics.Process]::Start($info)
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(15000)) { $process.Kill(); $process.WaitForExit(); throw 'worker-control-timeout' }
        if ($process.ExitCode -ne 0) { throw 'worker-control-unavailable' }
        return ($stdout.GetAwaiter().GetResult() | ConvertFrom-Json)
    } finally { $process.Dispose() }
}
$lock = $null
$child = $null
try {
    try { $lock = [IO.File]::Open((Join-Path $directory 'supervisor.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch [IO.IOException] {
        if (($_.Exception.HResult -band 0xffff) -notin @(32, 33)) { throw }
        Write-Event 'already-running' @{}
        exit 0
    }
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 1MB) { Move-Item $log "$log.previous" -Force }
    $settings = Get-Content (Join-Path $directory 'launcher.json') -Raw | ConvertFrom-Json
    $bundle = Join-Path $directory 'worker.mjs'
    foreach ($filename in @($settings.nodeExe, $settings.database, $bundle)) {
        if (-not [IO.Path]::IsPathRooted($filename) -or $filename -match '["\r\n]' -or -not (Test-Path -LiteralPath $filename -PathType Leaf)) { throw 'worker-path-unavailable' }
    }
    $env:PATH = (@($settings.executableDirectories) + @($env:PATH)) -join ';'
    $env:NODE_NO_WARNINGS = '1'
    if ($settings.pythonExe) {
        $version = & $settings.pythonExe -I -c 'import sys; print(sys.version.split()[0])'
        if ($LASTEXITCODE -ne 0 -or $version.Trim() -ne $settings.pythonVersion) { throw 'selected-python-unavailable-no-install-attempted' }
        if (-not (Test-Path -LiteralPath $settings.gitConfig -PathType Leaf)) { throw 'process-local-git-config-unavailable' }
        $env:LLMLAB_PYTHON_EXE = $settings.pythonExe
        $env:LLMLAB_PYTHON_AUTO_SETUP = '0'
        $env:NPM_CONFIG_OFFLINE = 'true'
        $env:UV_OFFLINE = '1'
        $env:GIT_CONFIG_GLOBAL = $settings.gitConfig
        $env:GIT_CONFIG_NOSYSTEM = '1'
    }
    $stop = Join-Path $directory 'stop.request'
    Remove-Item -LiteralPath $stop -Force -ErrorAction SilentlyContinue
    $stopSent = $false
    $delays = @(5, 15)
    Get-ChildItem -LiteralPath $logDirectory -File | Where-Object { $_.Name -match '\.(stdout|stderr)\.log$' } |
        Sort-Object Name -Descending | Select-Object -Skip 20 | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
    Write-Event 'supervisor-started' @{ maximumAttempts = 3; workspaceId = $settings.workspaceId }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        if (Test-Path -LiteralPath $stop) { Write-Event 'stop-requested' @{}; exit 0 }
        $configuration = Invoke-Control 'list'
        if ($configuration.id -ne $settings.workspaceId) { throw 'canonical-workspace-identity-changed' }
        $prior = Invoke-Control 'status'
        if ($prior.owner -notin @('released', 'dead')) {
            Write-Event 'owner-present-or-unconfirmed' @{ action = 'No worker launched; inspect canonical owner/control' }
            exit 2
        }
        $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff')
        $arguments = '"' + $bundle + '" orchestrate workspace start --database "' + $settings.database + '"'
        $stdoutFile = Join-Path $logDirectory "$stamp-$attempt.stdout.log"
        $child = Start-Process -FilePath $settings.nodeExe -ArgumentList $arguments -WorkingDirectory $directory -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutFile -RedirectStandardError (Join-Path $logDirectory "$stamp-$attempt.stderr.log")
        $null = $child.Handle
        @{ supervisorPid = $PID; childPid = $child.Id; startedAt = [DateTime]::UtcNow.ToString('o'); attempt = $attempt; workspaceId = $settings.workspaceId } |
            ConvertTo-Json | Set-Content (Join-Path $directory 'process.json') -Encoding UTF8
        Write-Event 'child-started' @{ childPid = $child.Id; attempt = $attempt }
        $ready = $false
        $unconfirmed = $false
        $deadline = [DateTime]::UtcNow.AddSeconds(90)
        $stopDeadline = $null
        while (-not $child.WaitForExit(1000)) {
            if ((Test-Path -LiteralPath $stop) -and -not $stopSent) {
                $stopSent = $true
                $stopDeadline = [DateTime]::UtcNow.AddSeconds(60)
                Write-Event 'stop-requested' @{ childPid = $child.Id }
                try { $null = Invoke-Control 'stop' }
                catch { Write-Event 'stop-control-unconfirmed' @{ action = 'Await canonical worker settlement; no forced kill or restart' } }
            }
            if ($stopSent -and $stopDeadline -and [DateTime]::UtcNow -gt $stopDeadline) {
                Write-Event 'stop-settlement-unconfirmed' @{ action = 'Inspect canonical operations; child is not killed or replayed' }
                $stopDeadline = $null
            }
            if (-not $ready -and -not $stopSent) {
                try {
                    $current = Invoke-Control 'status'
                    $admitted = @(Get-Content -LiteralPath $stdoutFile | Where-Object { $_ -like '{"event":"service-ready",*' } | ForEach-Object { $_ | ConvertFrom-Json })
                    if ($admitted.Count -eq 1 -and $admitted[0].status.ownerId -and $current.service.ownerId -eq $admitted[0].status.ownerId -and $current.service.state -in @('running', 'idle', 'paused')) {
                        $ready = $true
                        Write-Event 'ready' @{ childPid = $child.Id; attempt = $attempt; state = $current.service.state; initialConfigurationRevision = $configuration.revision }
                    }
                } catch {
                    if (-not $unconfirmed -and [DateTime]::UtcNow -gt $deadline) {
                        $unconfirmed = $true
                        Write-Event 'readiness-unconfirmed' @{ action = 'Existing child retained; inspect control, never launch a competing owner' }
                    }
                }
                if (-not $ready) { Start-Sleep -Seconds 3 }
            }
        }
        $code = $child.ExitCode
        Write-Event 'child-exited' @{ childPid = $child.Id; attempt = $attempt; exitCode = $code; wasReady = $ready }
        $child.Dispose()
        $child = $null
        # Native exit2 is a durable blocked outcome, not a crash to retry.
        if ($stopSent -or (Test-Path -LiteralPath $stop) -or $code -eq 0) { Write-Event 'stopped' @{}; exit 0 }
        if ($code -eq 2) { Write-Event 'worker-blocked' @{ action = 'Inspect canonical failure/unknown evidence; no automatic retry' }; exit 2 }
        if ($attempt -lt 3) {
            Write-Event 'retry-scheduled' @{ nextAttempt = $attempt + 1; delaySeconds = $delays[$attempt - 1] }
            for ($second = 0; $second -lt $delays[$attempt - 1]; $second++) {
                if (Test-Path -LiteralPath $stop) { Write-Event 'stopped' @{}; exit 0 }
                Start-Sleep -Seconds 1
            }
        }
    }
    Write-Event 'attempts-exhausted' @{ attempts = 3 }
    exit 1
} catch {
    Write-Event 'supervisor-failed' @{ action = 'Inspect installed paths, selected runtime and canonical status; no credentials or raw subprocess errors logged' }
    exit 1
} finally {
    if ($child) {
        # Never kill a possibly executing model just because supervision failed.
        Write-Event 'child-settlement-required' @{ childPid = $child.Id; action = 'Use canonical workspace stop/status; do not launch another owner' }
        $child.Dispose()
    }
    if ($lock) {
        Remove-Item -LiteralPath (Join-Path $directory 'process.json') -Force -ErrorAction SilentlyContinue
        $lock.Dispose()
    }
}
