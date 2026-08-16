param(
    [Parameter(Mandatory = $true)]
    [string]$CaptureDirectory,

    [ValidateRange(30, 3600)]
    [int]$PollSeconds = 120,

    [ValidateRange(120, 86400)]
    [int]$StaleSeconds = 600
)

$ErrorActionPreference = "Stop"
$capturePath = [System.IO.Path]::GetFullPath($CaptureDirectory)
$checkpointPath = Join-Path $capturePath "checkpoint.json"
$manifestPath = Join-Path $capturePath "manifest.json"
$monitorPath = "$capturePath.monitor"
$statePath = Join-Path $monitorPath "state.json"
$alertPath = Join-Path $monitorPath "alert.json"
$pidPath = Join-Path $monitorPath "monitor.pid"
$codexLogPath = Join-Path $monitorPath "codex.log"
$codexLastMessagePath = Join-Path $monitorPath "codex-last-message.md"
$repositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path

function Write-JsonAtomic {
    param(
        [Parameter(Mandatory = $true)] [string]$Path,
        [Parameter(Mandatory = $true)] [object]$Value
    )

    $temporaryPath = "$Path.tmp"
    $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporaryPath -Encoding utf8
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

function Write-AlertAndExit {
    param(
        [Parameter(Mandatory = $true)] [string]$Kind,
        [Parameter(Mandatory = $true)] [string]$Message,
        [object]$Snapshot = $null,
        [int]$ExitCode = 1,
        [bool]$InvokeRecovery = $true
    )

    $alert = [ordered]@{
        detectedAt = (Get-Date).ToUniversalTime().ToString("o")
        kind = $Kind
        message = $Message
        snapshot = $Snapshot
        recovery = if ($InvokeRecovery) { "starting" } else { "not_requested" }
    }
    Write-JsonAtomic -Path $alertPath -Value $alert

    if ($InvokeRecovery) {
        try {
            $codex = Get-Command codex.cmd -CommandType Application -ErrorAction Stop
            $prompt = @"
An unattended jufexk catalog capture monitor detected '$Kind'.

Work only on GitHub Issue #30 and the currently running full catalog capture. Do not work on #31 or later tickets. Read AGENTS.md, the current checkpoint and the alert at '$alertPath', then diagnose the actual evidence. Recover the existing batch without discarding completed units or starting an unnecessary full rerun. Browser interaction is allowed only when recovery requires it; the user is already logged in. After recovery, ensure an unattended monitor is running again. If the capture is terminal and valid, perform the required validation/audit/check and close #30 only when every acceptance condition is proved. Preserve unrelated worktree changes and never expose raw catalog data or credentials in GitHub comments.
"@
            $previousErrorActionPreference = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            try {
                $codexOutput = & $codex.Source exec --sandbox danger-full-access -c 'approval_policy="never"' -C $repositoryPath -o $codexLastMessagePath $prompt 2>&1
                $codexExitCode = $LASTEXITCODE
            }
            finally {
                $ErrorActionPreference = $previousErrorActionPreference
            }
            $codexOutput | Set-Content -LiteralPath $codexLogPath -Encoding utf8
            $alert.recovery = if ($codexExitCode -eq 0) { "completed" } else { "failed" }
            $alert.codexExitCode = $codexExitCode
            $alert.codexLog = $codexLogPath
            $alert.codexLastMessage = $codexLastMessagePath
        }
        catch {
            $_ | Out-String | Set-Content -LiteralPath $codexLogPath -Encoding utf8
            $alert.recovery = "launch_failed"
            $alert.codexExitCode = $null
            $alert.codexLog = $codexLogPath
            $alert.codexLastMessage = $null
        }
        Write-JsonAtomic -Path $alertPath -Value $alert
    }
    exit $ExitCode
}

if (-not (Test-Path -LiteralPath $capturePath -PathType Container)) {
    throw "Capture directory does not exist: $capturePath"
}
New-Item -ItemType Directory -Path $monitorPath -Force | Out-Null

if (Test-Path -LiteralPath $pidPath) {
    $existingPid = Get-Content -LiteralPath $pidPath -Raw -ErrorAction SilentlyContinue
    if ($existingPid -match '^\s*(\d+)\s*$' -and (Get-Process -Id ([int]$Matches[1]) -ErrorAction SilentlyContinue)) {
        throw "A capture monitor is already running with PID $($Matches[1])."
    }
}

$PID | Set-Content -LiteralPath $pidPath -Encoding ascii
Remove-Item -LiteralPath $alertPath -Force -ErrorAction SilentlyContinue

try {
    while ($true) {
        if (-not (Test-Path -LiteralPath $checkpointPath -PathType Leaf)) {
            Write-AlertAndExit -Kind "checkpoint_missing" -Message "checkpoint.json is missing"
        }

        try {
            $checkpoint = Get-Content -LiteralPath $checkpointPath -Raw -Encoding utf8 | ConvertFrom-Json
        }
        catch {
            Write-AlertAndExit -Kind "checkpoint_unreadable" -Message $_.Exception.Message
        }

        $checkpointFile = Get-Item -LiteralPath $checkpointPath
        $ageSeconds = [math]::Round(((Get-Date) - $checkpointFile.LastWriteTime).TotalSeconds, 1)
        $complete = @($checkpoint.queries | Where-Object status -eq "complete").Count
        $exceptions = @($checkpoint.queries | Where-Object status -eq "exception").Count
        $current = $checkpoint.queries | Where-Object status -eq "pending" | Select-Object -First 1
        $snapshot = [ordered]@{
            checkedAt = (Get-Date).ToUniversalTime().ToString("o")
            batchId = $checkpoint.batchId
            phase = $checkpoint.phase
            complete = $complete
            total = @($checkpoint.queries).Count
            exceptions = $exceptions
            currentQuery = $current.queryId
            nextPage = $current.nextPage
            checkpointAgeSeconds = $ageSeconds
            manifestExists = Test-Path -LiteralPath $manifestPath -PathType Leaf
        }
        Write-JsonAtomic -Path $statePath -Value $snapshot

        if ($exceptions -gt 0) {
            Write-AlertAndExit -Kind "capture_exception" -Message "$exceptions capture unit(s) ended in exception" -Snapshot $snapshot
        }
        if ($checkpoint.phase -eq "complete") {
            if (-not $snapshot.manifestExists) {
                Write-AlertAndExit -Kind "manifest_missing" -Message "Capture completed without manifest.json" -Snapshot $snapshot
            }
            Write-AlertAndExit -Kind "capture_complete" -Message "Capture and export completed" -Snapshot $snapshot -ExitCode 0 -InvokeRecovery $false
        }
        if ($checkpoint.phase -ne "running") {
            Write-AlertAndExit -Kind "capture_terminal" -Message "Capture entered phase '$($checkpoint.phase)'" -Snapshot $snapshot
        }
        if ($ageSeconds -ge $StaleSeconds) {
            Write-AlertAndExit -Kind "capture_stalled" -Message "Checkpoint has not changed for $ageSeconds seconds" -Snapshot $snapshot
        }

        Start-Sleep -Seconds $PollSeconds
    }
}
finally {
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}
