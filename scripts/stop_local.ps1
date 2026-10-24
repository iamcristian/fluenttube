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

    # Verify process identity before terminating to protect unrelated applications
    $validNames = @("python", "node", "cmd", "npm", "powershell", "pwsh")
    $matched = $false
    foreach ($vn in $validNames) {
        if ($proc.ProcessName -like "*$vn*") {
            $matched = $true
            break
        }
    }

    if ($matched) {
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

# Supplementary port check to clean up any orphaned worker processes on ports 8000 and 5173
function Stop-PortListener([int]$Port, [string]$ServiceName) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($conns) {
            foreach ($conn in $conns) {
                $pidToKill = $conn.OwningProcess
                if ($pidToKill -gt 0) {
                    $p = Get-Process -Id $pidToKill -ErrorAction SilentlyContinue
                    if ($p -and ($p.ProcessName -like "*python*" -or $p.ProcessName -like "*node*")) {
                        Write-Host "  [+] Releasing port $Port held by $($p.ProcessName) (PID: $pidToKill)..." -ForegroundColor Yellow
                        & taskkill /PID $pidToKill /T /F 2>$null | Out-Null
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
