# FluentTube AI - Local Launcher Script (Task T24)
# Enforces strict port binding, environment diagnostics, PID tracking, and graceful browser launch.

[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [switch]$DevReload
)

$ErrorActionPreference = "Stop"

# Determine canonical project root
$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
$LogsDir = Join-Path $ProjectRoot "logs"
$PidFile = Join-Path $LogsDir "fluenttube_pids.json"

if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
}

Write-Host "`n=======================================================" -ForegroundColor Cyan
Write-Host "   FluentTube AI - Launching Local Services" -ForegroundColor Cyan
Write-Host "=======================================================`n" -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# 1. Environment and Dependency Checks
# -----------------------------------------------------------------------------
Write-Host "[1/5] Verifying environment and runtime dependencies..." -ForegroundColor Yellow

$VenvPython = Join-Path $ProjectRoot "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
    # Check system python
    $SystemPython = Get-Command "python" -ErrorAction SilentlyContinue
    if ($SystemPython) {
        $VenvPython = $SystemPython.Source
        Write-Host "      [NOTICE] backend\.venv not found; using system python ($VenvPython)." -ForegroundColor DarkYellow
    } else {
        Write-Host "`n[ERROR] Python runtime not found!" -ForegroundColor Red
        Write-Host "Please create the virtual environment first:" -ForegroundColor Red
        Write-Host "  py -3.11 -m venv backend\.venv" -ForegroundColor White
        Write-Host "  backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-lock.txt`n" -ForegroundColor White
        exit 1
    }
}

# Node.js check
$NodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
    Write-Host "`n[ERROR] Node.js is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install Node.js 18+ from https://nodejs.org/`n" -ForegroundColor White
    exit 1
}

# npm check
$NpmCmd = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
if (-not $NpmCmd) {
    $NpmCmd = Get-Command "npm" -ErrorAction SilentlyContinue
}
if (-not $NpmCmd) {
    Write-Host "`n[ERROR] npm is not found in PATH." -ForegroundColor Red
    exit 1
}

# FFmpeg check
$FfmpegCmd = Get-Command "ffmpeg" -ErrorAction SilentlyContinue
if (-not $FfmpegCmd) {
    Write-Host "      [WARNING] FFmpeg was not found in PATH." -ForegroundColor DarkYellow
    Write-Host "      Audio transcoding and YouTube downloads require FFmpeg." -ForegroundColor DarkYellow
    Write-Host "      Install FFmpeg or ensure ffmpeg.exe is in system PATH.`n" -ForegroundColor DarkYellow
} else {
    Write-Host "      FFmpeg: Installed ($($FfmpegCmd.Source))" -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# 2. Strict Port Availability Checks
# -----------------------------------------------------------------------------
Write-Host "[2/5] Checking port availability (8000 Backend, 5173 Frontend)..." -ForegroundColor Yellow

function Test-PortOccupied([int]$Port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($conn) {
            return $conn[0].OwningProcess
        }
    } catch {
        # Fallback to netstat if Get-NetTCPConnection fails or lacks permissions
        $netstat = netstat -ano | Select-String ":$Port\s+.*LISTENING\s+(\d+)"
        if ($netstat) {
            if ($netstat[0].Matches[0].Groups[1].Value) {
                return [int]$netstat[0].Matches[0].Groups[1].Value
            }
        }
    }
    return $null
}

$Occupied8000 = Test-PortOccupied 8000
if ($Occupied8000) {
    Write-Host "`n[ERROR] Port 8000 is already in use by process PID $Occupied8000." -ForegroundColor Red
    Write-Host "FluentTube AI requires port 8000 for backend API (strict binding)." -ForegroundColor Red
    Write-Host "Please close the application using port 8000 and try again." -ForegroundColor White
    Write-Host "(Run 'scripts/stop_local.ps1' if this was a previous FluentTube session).`n" -ForegroundColor White
    exit 1
}

$Occupied5173 = Test-PortOccupied 5173
if ($Occupied5173) {
    Write-Host "`n[ERROR] Port 5173 is already in use by process PID $Occupied5173." -ForegroundColor Red
    Write-Host "FluentTube AI requires port 5173 for frontend web app (strict binding)." -ForegroundColor Red
    Write-Host "Please close the application using port 5173 and try again.`n" -ForegroundColor White
    exit 1
}

Write-Host "      Ports 8000 and 5173 are free." -ForegroundColor Green

# -----------------------------------------------------------------------------
# 3. Clean Prior PID Tracking
# -----------------------------------------------------------------------------
if (Test-Path $PidFile) {
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

# -----------------------------------------------------------------------------
# 4. Start Background Services
# -----------------------------------------------------------------------------
Write-Host "[3/5] Starting Backend service on http://127.0.0.1:8000..." -ForegroundColor Yellow

$BackendOutLog = Join-Path $LogsDir "backend.log"
$BackendErrLog = Join-Path $LogsDir "backend.err.log"

$UvicornArgs = @("-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", "8000", "--workers", "1")
if ($DevReload) {
    $UvicornArgs += "--reload"
    Write-Host "      [OPT-IN] Development auto-reload enabled." -ForegroundColor Cyan
}

$BackendProcess = Start-Process `
    -FilePath $VenvPython `
    -ArgumentList $UvicornArgs `
    -WorkingDirectory $ProjectRoot `
    -RedirectStandardOutput $BackendOutLog `
    -RedirectStandardError $BackendErrLog `
    -PassThru

Write-Host "      Backend started (PID: $($BackendProcess.Id))" -ForegroundColor Green

Write-Host "[4/5] Starting Frontend service on http://127.0.0.1:5173..." -ForegroundColor Yellow

$FrontendOutLog = Join-Path $LogsDir "frontend.log"
$FrontendErrLog = Join-Path $LogsDir "frontend.err.log"

$FrontendDir = Join-Path $ProjectRoot "frontend"

$FrontendProcess = Start-Process `
    -FilePath $NpmCmd.Source `
    -ArgumentList @("run", "dev") `
    -WorkingDirectory $FrontendDir `
    -RedirectStandardOutput $FrontendOutLog `
    -RedirectStandardError $FrontendErrLog `
    -PassThru

Write-Host "      Frontend started (PID: $($FrontendProcess.Id))" -ForegroundColor Green

# Record tracked PIDs
$PidData = @{
    backend_pid = $BackendProcess.Id
    frontend_pid = $FrontendProcess.Id
    started_at = (Get-Date).ToString("o")
    backend_url = "http://127.0.0.1:8000"
    frontend_url = "http://127.0.0.1:5173"
}
$PidData | ConvertTo-Json | Set-Content -Path $PidFile -Encoding UTF8

# -----------------------------------------------------------------------------
# 5. Health Probing and Browser Opening
# -----------------------------------------------------------------------------
Write-Host "[5/5] Waiting for services to become healthy..." -ForegroundColor Yellow

$MaxWaitSeconds = 25
$StartTime = Get-Date
$BackendHealthy = $false
$FrontendHealthy = $false

while (((Get-Date) - $StartTime).TotalSeconds -lt $MaxWaitSeconds) {
    if (-not $BackendHealthy) {
        try {
            $resp = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/health" -Method Get -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
            if ($resp -and $resp.status -eq "ok") {
                $BackendHealthy = $true
            }
        } catch { }
    }

    if (-not $FrontendHealthy) {
        try {
            $fResp = Invoke-WebRequest -Uri "http://127.0.0.1:5173" -Method Get -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
            if ($fResp -and $fResp.StatusCode -eq 200) {
                $FrontendHealthy = $true
            }
        } catch { }
    }

    if ($BackendHealthy -and $FrontendHealthy) {
        break
    }

    Start-Sleep -Milliseconds 600
}

Write-Host "`n=======================================================" -ForegroundColor Green
if ($BackendHealthy -and $FrontendHealthy) {
    Write-Host "  FluentTube AI services are UP and HEALTHY!" -ForegroundColor Green
} else {
    Write-Host "  Services launched. Verify logs in logs/ directory." -ForegroundColor Yellow
}
Write-Host "  Frontend URL: http://127.0.0.1:5173" -ForegroundColor White
Write-Host "  Backend API:  http://127.0.0.1:8000/api/health" -ForegroundColor White
Write-Host "=======================================================" -ForegroundColor Green
Write-Host "  Stop services anytime: .\scripts/stop_local.ps1`n" -ForegroundColor Cyan

if (-not $NoBrowser) {
    Start-Process "http://127.0.0.1:5173"
}
