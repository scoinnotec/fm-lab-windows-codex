#Requires -Version 5.1
<#
.SYNOPSIS
Stops the fm-lab-windows-codex REST API and Vite frontend on Windows.

.DESCRIPTION
Windows/Codex counterpart to tools/stop-servers.sh. It finds listening
processes on ports 5173 and 3003 with PowerShell/netstat and stops them.

External programs and libraries:
- PowerShell 5.1+ or PowerShell 7+: https://learn.microsoft.com/powershell/
- Optional Node.js/npm processes started by tools/start-servers.ps1

No Python packages are required.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Help {
    @"
fm-lab-windows-codex server stop for Windows/Codex

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\stop-servers.ps1

Stops listening processes on:
  Frontend: 5173
  REST API: 3003

External dependency:
  PowerShell: https://learn.microsoft.com/powershell/
"@ | Write-Host
}

function Write-Info {
    param([string]$Message)
    Write-Host "[OK] $Message"
}

function Write-WarnLine {
    param([string]$Message)
    Write-Host "[WARN] $Message"
}

function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host $Message
}

function Get-ListenPids {
    param([Parameter(Mandatory = $true)][int]$Port)

    $pids = @()
    try {
        $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
        if ($connections.Count -gt 0) {
            $pids = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
        }
    } catch {
        $pids = @()
    }

    if ($pids.Count -eq 0) {
        try {
            $regex = "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)"
            $pids = @(netstat -ano -p tcp | ForEach-Object {
                $match = [regex]::Match($_, $regex)
                if ($match.Success) { [int]$match.Groups[1].Value }
            } | Sort-Object -Unique)
        } catch {
            $pids = @()
        }
    }

    return @($pids | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
}

function Stop-Port {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $pids = @(Get-ListenPids -Port $Port)
    if ($pids.Count -eq 0) {
        Write-Info "No $Label active on port $Port"
        return $false
    }

    foreach ($pidValue in $pids) {
        Stop-Process -Id $pidValue -ErrorAction SilentlyContinue
    }

    Start-Sleep -Seconds 1
    $remaining = @(Get-ListenPids -Port $Port)
    if ($remaining.Count -gt 0) {
        foreach ($pidValue in $remaining) {
            Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Milliseconds 500
        Write-WarnLine "$Label stopped forcefully (PID $($remaining -join ', '))"
    } else {
        Write-Info "$Label stopped (PID $($pids -join ', '))"
    }

    return $true
}

if (@($args) -contains "--help" -or @($args) -contains "-h" -or @($args) -contains "/?") {
    Show-Help
    exit 0
}

$frontendStopped = $false
$apiStopped = $false

Write-Header "Frontend (Port 5173)"
if (Stop-Port -Port 5173 -Label "Frontend server") {
    $frontendStopped = $true
}

Write-Header "REST-API (Port 3003)"
if (Stop-Port -Port 3003 -Label "REST-API server") {
    $apiStopped = $true
}

Write-Header "Status"
if ($frontendStopped -or $apiStopped) {
    if ($apiStopped) {
        Write-Host "  REST-API:  stopped"
    } else {
        Write-Host "  REST-API:  was not active"
    }

    if ($frontendStopped) {
        Write-Host "  Frontend:  stopped"
    } else {
        Write-Host "  Frontend:  was not active"
    }
} else {
    Write-Host "  No servers were active."
}
