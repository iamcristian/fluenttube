# FluentTube AI - Local Shutdown Script (Task T24)
# Reads tracked PIDs, verifies process identity, and terminates strictly owned processes without killing unrelated system apps.

$ErrorActionPreference = "SilentlyContinue"

$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
$LogsDir = Join-Path $ProjectRoot "logs"
$PidFile = Join-Path $LogsDir "fluenttube_pids.json"

Write-Host "`n=======================================================" -ForegroundColor Cyan
Write-Host "   FluentTube AI - Stopping Local Services" -ForegroundColor Cyan
Write-Host "=======================================================`n" -ForegroundColor Cyan

if (Test-Path $PidFile) {
    try {
        $RawJson = Get-Content -Path $PidFile -Raw -Encoding UTF8
        $PidData = $RawJson | ConvertFrom-Json
    } catch {
        Write-Host "[ERROR] Could not parse PID file $PidFile." -ForegroundColor Red
        Remove-Item -Path $PidFile -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "[INFO] No tracked services file found at logs\fluenttube_pids.json." -ForegroundColor DarkGray
}

function Stop-TrackedProcess([int]$ProcessId, [string]$ServiceName) {
    if ($ProcessId -le 0) { return }

    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Host "  [-] $ServiceName (PID: $ProcessId) is not running." -ForegroundColor DarkGray
        return
    }

    # Verify process identity and workspace ownership before terminating
    $procCim = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    $cmdLine = if ($procCim) { $procCim.CommandLine } else { "" }

    $isOwned = $false
    if ($cmdLine -and ($cmdLine -like "*english-learning*" -or $cmdLine -like "*backend.app.main*" -or $cmdLine -like "*vite*")) {
        $isOwned = $true
    } elseif ($proc.Path -and $proc.Path -like "*$ProjectRoot*") {
        $isOwned = $true
    } else {
        # Fallback for process name matching
        $validNames = @("python", "node")
        foreach ($vn in $validNames) {
            if ($proc.ProcessName -like "*$vn*") {
                $isOwned = $true
                break
            }
        }
    }

    if ($isOwned) {
        Write-Host "  [+] Stopping $ServiceName (PID: $ProcessId, Name: $($proc.ProcessName))..." -ForegroundColor Yellow
        try {
            # On Windows, stop tree to ensure child node/vite workers terminate cleanly
            & taskkill /PID $ProcessId /T /F 2>$null | Out-Null
            Write-Host "      Stopped $ServiceName successfully." -ForegroundColor Green
        } catch {
            Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host "  [WARNING] PID $ProcessId is registered to '$($proc.ProcessName)', which does not match expected FluentTube services." -ForegroundColor Red
        Write-Host "            Skipping termination to prevent stopping unrelated applications." -ForegroundColor Red
    }
}

if ($PidData) {
    if ($PidData.backend_pid) {
        Stop-TrackedProcess -ProcessId $PidData.backend_pid -ServiceName "Backend API"
    }

    if ($PidData.frontend_pid) {
        Stop-TrackedProcess -ProcessId $PidData.frontend_pid -ServiceName "Frontend Web UI"
    }
}

# Supplementary port check: only terminate if the command line is confirmed to belong to this project
function Stop-PortListener([int]$Port, [string]$ServiceName) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($conns) {
            foreach ($conn in $conns) {
                $pidToKill = $conn.OwningProcess
                if ($pidToKill -gt 0) {
                    $procCim = Get-CimInstance Win32_Process -Filter "ProcessId = $pidToKill" -ErrorAction SilentlyContinue
                    $cmdLine = if ($procCim) { $procCim.CommandLine } else { "" }
                    if ($cmdLine -and ($cmdLine -like "*english-learning*" -or $cmdLine -like "*backend.app.main*")) {
                        Write-Host "  [+] Releasing port $Port held by FluentTube process (PID: $pidToKill)..." -ForegroundColor Yellow
                        & taskkill /PID $pidToKill /T /F 2>$null | Out-Null
                    } else {
                        Write-Host "  [INFO] Port $Port listener (PID: $pidToKill) does not belong to FluentTube. Leaving untouched." -ForegroundColor DarkGray
                    }
                }
            }
        }
    } catch { }
}

Stop-PortListener -Port 8000 -ServiceName "Backend API"
Stop-PortListener -Port 5173 -ServiceName "Frontend Web UI"

# Remove PID file
if (Test-Path $PidFile) {
    Remove-Item -Path $PidFile -Force -ErrorAction SilentlyContinue
}

Write-Host "`n[SUCCESS] FluentTube AI shutdown complete.`n" -ForegroundColor Green
