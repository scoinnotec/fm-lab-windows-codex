#Requires -Version 5.1
<#
.SYNOPSIS
Starts the fm-lab-windows-codex REST API and Vite frontend on Windows.

.DESCRIPTION
Windows/Codex counterpart to tools/start-servers.sh. It uses PowerShell process
and port inspection instead of lsof/nohup. Logs are written to logs/*.log.

External programs and libraries:
- Node.js LTS and npm: https://nodejs.org/
  Install example: winget install OpenJS.NodeJS.LTS
- PowerShell 5.1+ or PowerShell 7+: https://learn.microsoft.com/powershell/

No Python packages are required.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Help {
    @"
fm-lab-windows-codex server start for Windows/Codex

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-servers.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-servers.ps1 --codex
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-servers.ps1 --claude
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-servers.ps1 --import-xml
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-servers.ps1 --xml Kontakte.xml
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-servers.ps1 --skip-import
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-servers.ps1 --no-start-website
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-servers.ps1 --no-open-browser
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-servers.ps1 --no-provider-prompt

Starts:
  REST API:  http://localhost:3003
  Frontend:  http://localhost:5173

Requirements:
  - PowerShell 5.1+ or PowerShell 7+
  - Node.js LTS and npm; the script can offer winget installation
  - DuckDB CLI for XML import; the script asks once if it cannot find it
  - A DuckDB database created from an XML import

XML import:
  --import-xml          Import all XML files from xml/ into DuckDB before starting
  --xml <name|all>      Import one XML file from xml/, or all XML files
  --skip-import         Do not ask for XML import

Website start:
  --start-website       Start REST API and frontend after optional import
  --no-start-website    Do not start REST API/frontend after optional import
  --open-browser        Open http://localhost:5173 after frontend is ready
  --no-open-browser     Do not open the browser after frontend is ready

AI provider:
  --codex               Use OpenAI/Codex as default AI provider for this run
  --claude              Use Anthropic/Claude as default AI provider for this run
  --provider <id>       Use a provider id directly, for example openai, anthropic or ollama
  --no-provider-prompt  Do not ask; keep AI_PROVIDER or default to openai

External dependencies:
  Node.js LTS: https://nodejs.org/
  PowerShell: https://learn.microsoft.com/powershell/
  DuckDB CLI: https://duckdb.org/docs/installation/
  FileMaker XML export: FileMaker Pro > Tools > Save a Copy as XML
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

function Write-ErrorLine {
    param([string]$Message)
    Write-Host "[ERROR] $Message"
}

function Pause-OnError {
    if ([Environment]::UserInteractive) {
        Write-Host ""
        Read-Host "Press Enter after reviewing the error"
    }
}

function Exit-WithErrorPause {
    param([int]$Code = 1)

    Pause-OnError
    exit $Code
}

function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host $Message
}

function Write-CsvField {
    param([AllowNull()][object]$Value)

    $text = if ($null -eq $Value) { "" } else { [string]$Value }
    return '"' + ($text -replace '"', '""') + '"'
}

function Write-StartupCsvLog {
    param(
        [Parameter(Mandatory = $true)][string]$LogsDir,
        [string[]]$Arguments = @()
    )

    try {
        New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
        $logPath = Join-Path $LogsDir "powershell-start.csv"
        $header = "timestamp,event,process_id,powershell_version,working_directory,arguments"
        if (-not (Test-Path -LiteralPath $logPath)) {
            Set-Content -LiteralPath $logPath -Value $header -Encoding UTF8
        }

        $row = @(
            Write-CsvField (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
            Write-CsvField "start-servers.ps1"
            Write-CsvField $PID
            Write-CsvField $PSVersionTable.PSVersion.ToString()
            Write-CsvField (Get-Location).Path
            Write-CsvField ($Arguments -join " ")
        ) -join ","

        Add-Content -LiteralPath $logPath -Value $row -Encoding UTF8
    } catch {
        Write-WarnLine "Could not write startup CSV log: $($_.Exception.Message)"
    }
}

function Set-ConsoleWidth {
    param([int]$DesiredWidth = 146)

    if (-not [Environment]::UserInteractive) {
        return 0
    }

    try {
        $currentHeight = [Math]::Max([Console]::WindowHeight, 35)
        & mode.com con: cols=$DesiredWidth lines=$currentHeight | Out-Null
        Start-Sleep -Milliseconds 80
    } catch {
        # mode.com is not available or cannot resize the current host.
    }

    try {
        $currentHeight = [Math]::Max([Console]::WindowHeight, 35)
        $escape = [char]27
        [Console]::Write(("{0}[8;{1};{2}t" -f $escape, $currentHeight, $DesiredWidth))
        Start-Sleep -Milliseconds 80
    } catch {
        # Some hosts do not support terminal resize escape sequences.
    }

    try {
        $rawUi = $Host.UI.RawUI
        $maxWidth = [Math]::Max(1, $rawUi.MaxWindowSize.Width)
        $targetWidth = [Math]::Min($DesiredWidth, $maxWidth)

        if ($rawUi.BufferSize.Width -lt $targetWidth) {
            $rawUi.BufferSize = New-Object System.Management.Automation.Host.Size(
                $targetWidth,
                [Math]::Max($rawUi.BufferSize.Height, $rawUi.WindowSize.Height)
            )
        }

        if ($rawUi.WindowSize.Width -lt $targetWidth) {
            $rawUi.WindowSize = New-Object System.Management.Automation.Host.Size(
                $targetWidth,
                $rawUi.WindowSize.Height
            )
        }

        return $rawUi.WindowSize.Width
    } catch {
        try {
            return [Console]::WindowWidth
        } catch {
            return 0
        }
    }
}

function Initialize-WindowTools {
    if ("FmLabWindowTools.NativeMethods" -as [type]) {
        return $true
    }

    try {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace FmLabWindowTools {
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public static class NativeMethods {
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

        [DllImport("user32.dll")]
        public static extern bool SystemParametersInfo(int uiAction, int uiParam, out RECT pvParam, int fWinIni);
    }
}
"@
        return $true
    } catch {
        return $false
    }
}

function Center-ConsoleWindow {
    if (-not [Environment]::UserInteractive) {
        return
    }

    if (-not (Initialize-WindowTools)) {
        return
    }

    try {
        $handle = [FmLabWindowTools.NativeMethods]::GetForegroundWindow()
        if ($handle -eq [IntPtr]::Zero) {
            return
        }

        $rect = New-Object FmLabWindowTools.RECT
        $workArea = New-Object FmLabWindowTools.RECT
        $hasWindow = [FmLabWindowTools.NativeMethods]::GetWindowRect($handle, [ref]$rect)
        $hasWorkArea = [FmLabWindowTools.NativeMethods]::SystemParametersInfo(0x0030, 0, [ref]$workArea, 0)
        if (-not $hasWindow -or -not $hasWorkArea) {
            return
        }

        $width = $rect.Right - $rect.Left
        $height = $rect.Bottom - $rect.Top
        $screenWidth = $workArea.Right - $workArea.Left
        $screenHeight = $workArea.Bottom - $workArea.Top
        if ($width -le 0 -or $height -le 0 -or $screenWidth -le 0 -or $screenHeight -le 0) {
            return
        }

        $x = [int]($workArea.Left + (($screenWidth - $width) / 2))
        $y = [int]($workArea.Top + (($screenHeight - $height) / 2))
        if ($x -lt $workArea.Left) { $x = $workArea.Left }
        if ($y -lt $workArea.Top) { $y = $workArea.Top }

        [void][FmLabWindowTools.NativeMethods]::MoveWindow($handle, $x, $y, $width, $height, $true)
    } catch {
        # Moving the current terminal window is best-effort only.
    }
}

function Show-Logo {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    $logoPath = Join-Path $ProjectRoot "docs\ASCII-Logo.txt"
    if (Test-Path -LiteralPath $logoPath) {
        $logoLines = @(Get-Content -LiteralPath $logoPath)
        $logoWidth = ($logoLines | ForEach-Object { $_.Length } | Measure-Object -Maximum).Maximum
        $actualWidth = Set-ConsoleWidth -DesiredWidth ([Math]::Max(146, $logoWidth + 4))
        Center-ConsoleWindow

        Write-Host ""
        if ($actualWidth -eq 0 -or $actualWidth -ge $logoWidth) {
            $logoLines | ForEach-Object { Write-Host $_ }
        } else {
            Write-Host "fm-lab-windows-codex"
            Write-WarnLine "Terminal width is $actualWidth columns; the full ASCII logo needs $logoWidth columns."
            Write-WarnLine "Maximize the terminal or reduce the font size to show the full logo."
        }
        Write-Host ""
    }
}

function Get-ProjectRoot {
    $root = $null
    try {
        $gitRoot = & git -C $PSScriptRoot rev-parse --show-toplevel 2>$null | Select-Object -First 1
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($gitRoot)) {
            $root = $gitRoot.Trim()
        }
    } catch {
        $root = $null
    }

    if ([string]::IsNullOrWhiteSpace($root)) {
        $root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
    }

    return $root
}

function Resolve-Executable {
    param([Parameter(Mandatory = $true)][string[]]$Names)
    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) {
            return $command.Source
        }
    }
    return $null
}

function Resolve-NodeExecutable {
    $node = Resolve-Executable -Names @("node.exe", "node")
    if ($node) {
        return $node
    }

    $candidatePaths = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    )

    foreach ($candidate in $candidatePaths) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }
        $expanded = [Environment]::ExpandEnvironmentVariables($candidate)
        if (Test-Path -LiteralPath $expanded) {
            return (Resolve-Path -LiteralPath $expanded).Path
        }
    }

    return $null
}

function Resolve-NpmExecutable {
    $npm = Resolve-Executable -Names @("npm.cmd", "npm")
    if ($npm) {
        return $npm
    }

    $candidatePaths = @(
        "$env:ProgramFiles\nodejs\npm.cmd",
        "${env:ProgramFiles(x86)}\nodejs\npm.cmd",
        "$env:LOCALAPPDATA\Programs\nodejs\npm.cmd"
    )

    foreach ($candidate in $candidatePaths) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }
        $expanded = [Environment]::ExpandEnvironmentVariables($candidate)
        if (Test-Path -LiteralPath $expanded) {
            return (Resolve-Path -LiteralPath $expanded).Path
        }
    }

    return $null
}

function Install-NodeWithWingetIfApproved {
    if (-not [Environment]::UserInteractive) {
        return $false
    }

    $winget = Resolve-Executable -Names @("winget.exe", "winget")
    if (-not $winget) {
        Write-WarnLine "winget was not found, so Node.js cannot be installed automatically."
        Write-Host "Install Node.js LTS manually from https://nodejs.org/ and start this PowerShell file again."
        return $false
    }

    Write-Header "Node.js"
    Write-WarnLine "Node.js LTS and npm are required for the REST API and website."
    $installNode = Read-YesNoChoice -Prompt "Install Node.js LTS with winget now?" -DefaultYes $true
    if (-not $installNode) {
        Write-Host "Install Node.js LTS manually from https://nodejs.org/ and start this PowerShell file again."
        return $false
    }

    Write-Host "Installing Node.js LTS via winget..."
    & $winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-WarnLine "winget Node.js installation returned exit code $LASTEXITCODE."
        return $false
    }

    Write-Info "Node.js installation completed. If Windows has not refreshed PATH yet, this script will also check the common install folders."
    return $true
}

function Ensure-NodeAndNpm {
    $nodeBin = Resolve-NodeExecutable
    $npmBin = Resolve-NpmExecutable

    if (-not $nodeBin -or -not $npmBin) {
        [void](Install-NodeWithWingetIfApproved)
        $nodeBin = Resolve-NodeExecutable
        $npmBin = Resolve-NpmExecutable
    }

    if (-not $nodeBin) {
        Write-ErrorLine "Node.js not found. Install Node.js LTS from https://nodejs.org/ and start this PowerShell file again."
        Exit-WithErrorPause -Code 1
    }

    if (-not $npmBin) {
        Write-ErrorLine "npm not found. Install Node.js LTS from https://nodejs.org/ and start this PowerShell file again."
        Exit-WithErrorPause -Code 1
    }

    Write-Info "Node.js: $nodeBin"
    Write-Info "npm: $npmBin"
    return [pscustomobject]@{
        Node = $nodeBin
        Npm = $npmBin
    }
}

function Invoke-NpmChecked {
    param(
        [Parameter(Mandatory = $true)][string]$NpmBin,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Label
    )

    Write-Header $Label
    Write-Host "Working directory: $WorkingDirectory"
    Write-Host "Command: npm $($Arguments -join ' ')"
    & $NpmBin @Arguments
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorLine "$Label failed with exit code $LASTEXITCODE."
        Exit-WithErrorPause -Code $LASTEXITCODE
    }
}

function Test-SharedBuildRequired {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    $sharedSrc = Join-Path $ProjectRoot "packages\shared\src"
    $sharedDist = Join-Path $ProjectRoot "packages\shared\dist\src\index.js"

    if (-not (Test-Path -LiteralPath $sharedDist)) {
        return $true
    }

    if (-not (Test-Path -LiteralPath $sharedSrc)) {
        return $false
    }

    try {
        $latestSource = Get-ChildItem -LiteralPath $sharedSrc -Recurse -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTimeUtc -Descending |
            Select-Object -First 1
        if ($latestSource -and $latestSource.LastWriteTimeUtc -gt (Get-Item -LiteralPath $sharedDist).LastWriteTimeUtc) {
            return $true
        }
    } catch {
        return $false
    }

    return $false
}

function Ensure-NpmDependencies {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$NpmBin
    )

    $packageJson = Join-Path $ProjectRoot "package.json"
    if (-not (Test-Path -LiteralPath $packageJson)) {
        Write-ErrorLine "package.json not found in project root: $ProjectRoot"
        Exit-WithErrorPause -Code 1
    }

    $nodeModules = Join-Path $ProjectRoot "node_modules"
    $viteCmd = Join-Path $ProjectRoot "node_modules\.bin\vite.cmd"
    $viteShim = Join-Path $ProjectRoot "node_modules\.bin\vite"

    if (-not (Test-Path -LiteralPath $nodeModules) -or (-not (Test-Path -LiteralPath $viteCmd) -and -not (Test-Path -LiteralPath $viteShim))) {
        Invoke-NpmChecked -NpmBin $NpmBin -Arguments @("install") -WorkingDirectory $ProjectRoot -Label "Installing npm dependencies"
    } else {
        Write-Info "npm dependencies already installed"
    }

    if (Test-SharedBuildRequired -ProjectRoot $ProjectRoot) {
        Invoke-NpmChecked -NpmBin $NpmBin -Arguments @("run", "build:shared") -WorkingDirectory $ProjectRoot -Label "Building shared package"
    } else {
        Write-Info "Shared package build already present"
    }
}

function Get-LocalSettingsPath {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)
    return Join-Path $ProjectRoot ".fmlab\local-settings.json"
}

function Read-LocalSettings {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    $settingsPath = Get-LocalSettingsPath -ProjectRoot $ProjectRoot
    if (-not (Test-Path -LiteralPath $settingsPath)) {
        return [pscustomobject]@{}
    }

    try {
        return Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    } catch {
        Write-WarnLine "Ignoring unreadable local settings file: $settingsPath"
        return [pscustomobject]@{}
    }
}

function Write-LocalDuckDbPath {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$DuckDbPath
    )

    $settingsPath = Get-LocalSettingsPath -ProjectRoot $ProjectRoot
    $settingsDir = Split-Path -Parent $settingsPath
    New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null

    $settings = Read-LocalSettings -ProjectRoot $ProjectRoot
    if ($settings.PSObject.Properties.Name -contains "duckdb_exe") {
        $settings.duckdb_exe = $DuckDbPath
    } else {
        $settings | Add-Member -NotePropertyName "duckdb_exe" -NotePropertyValue $DuckDbPath
    }

    $settings | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $settingsPath -Encoding UTF8
}

function Resolve-DuckDbCliPath {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    $command = Get-Command "duckdb" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
        return $command.Source
    }

    $settings = Read-LocalSettings -ProjectRoot $ProjectRoot
    $commonWindowsDuckDb = Find-DuckDbInCommonWindowsDirs
    $candidatePaths = @(
        $env:FM_LAB_DUCKDB_EXE,
        $env:DUCKDB_EXE,
        $(if ($settings.duckdb_exe) { [string]$settings.duckdb_exe } else { "" }),
        $commonWindowsDuckDb,
        (Join-Path $ProjectRoot "duckdb\duckdb.exe"),
        (Join-Path $ProjectRoot "tools\duckdb\duckdb.exe"),
        "$env:LOCALAPPDATA\Programs\DuckDB\duckdb.exe",
        "$env:USERPROFILE\.duckdb\cli\latest\duckdb.exe",
        "C:\Program Files\DuckDB\duckdb.exe",
        "C:\Program Files (x86)\DuckDB\duckdb.exe"
    )

    foreach ($candidate in $candidatePaths) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }
        $expanded = [Environment]::ExpandEnvironmentVariables($candidate)
        if (Test-Path -LiteralPath $expanded) {
            return (Resolve-Path -LiteralPath $expanded).Path
        }
    }

    return ""
}

function Find-DuckDbInCommonWindowsDirs {
    $candidatePaths = @(
        "$env:LOCALAPPDATA\Programs\DuckDB\duckdb.exe",
        "$env:USERPROFILE\.duckdb\cli\latest\duckdb.exe",
        "$env:USERPROFILE\scoop\apps\duckdb\current\duckdb.exe",
        "$env:SCOOP\apps\duckdb\current\duckdb.exe",
        "$env:SCOOP_GLOBAL\apps\duckdb\current\duckdb.exe",
        "$env:ChocolateyInstall\bin\duckdb.exe",
        "$env:ProgramData\chocolatey\bin\duckdb.exe",
        "$env:ProgramFiles\DuckDB\duckdb.exe",
        "${env:ProgramFiles(x86)}\DuckDB\duckdb.exe"
    )

    foreach ($candidate in $candidatePaths) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }
        $expanded = [Environment]::ExpandEnvironmentVariables($candidate)
        if (Test-Path -LiteralPath $expanded) {
            return (Resolve-Path -LiteralPath $expanded).Path
        }
    }

    $wingetRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    if (Test-Path -LiteralPath $wingetRoot) {
        try {
            $wingetDuckDb = Get-ChildItem -LiteralPath $wingetRoot -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -match 'duckdb' } |
                ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Filter duckdb.exe -Recurse -File -ErrorAction SilentlyContinue } |
                Select-Object -First 1
            if ($wingetDuckDb) {
                return $wingetDuckDb.FullName
            }
        } catch {
            return ""
        }
    }

    return ""
}

function Install-DuckDbWithWingetIfApproved {
    if (-not [Environment]::UserInteractive) {
        return $false
    }

    $winget = Resolve-Executable -Names @("winget.exe", "winget")
    if (-not $winget) {
        Write-WarnLine "winget was not found, so DuckDB cannot be installed automatically."
        return $false
    }

    Write-Host ""
    Write-Host "DuckDB CLI is required to import FileMaker XML files."
    Write-Host "The Windows package used here is: DuckDB CLI (winget id: DuckDB.cli)."
    $installDuckDb = Read-YesNoChoice -Prompt "Install DuckDB CLI with winget now?" -DefaultYes $true
    if (-not $installDuckDb) {
        return $false
    }

    Write-Host "Installing DuckDB CLI via winget..."
    & $winget install --id DuckDB.cli --exact --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-WarnLine "winget DuckDB installation returned exit code $LASTEXITCODE."
        return $false
    }

    Write-Info "DuckDB CLI installation completed. Searching common Windows install folders again."
    return $true
}

function Ensure-DuckDbCliForImport {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    $duckDbPath = Resolve-DuckDbCliPath -ProjectRoot $ProjectRoot
    if (-not [string]::IsNullOrWhiteSpace($duckDbPath)) {
        $env:FM_LAB_DUCKDB_EXE = $duckDbPath
        Write-Info "DuckDB CLI: $duckDbPath"
        return
    }

    Write-Header "DuckDB"
    Write-WarnLine "DuckDB CLI was not found automatically."
    [void](Install-DuckDbWithWingetIfApproved)

    $duckDbPath = Resolve-DuckDbCliPath -ProjectRoot $ProjectRoot
    if (-not [string]::IsNullOrWhiteSpace($duckDbPath)) {
        $env:FM_LAB_DUCKDB_EXE = $duckDbPath
        Write-LocalDuckDbPath -ProjectRoot $ProjectRoot -DuckDbPath $duckDbPath
        Write-Info "DuckDB CLI: $duckDbPath"
        Write-Info "DuckDB path saved locally in .fmlab\local-settings.json"
        return
    }

    Write-Host "Enter the full path to duckdb.exe, or press Enter to cancel the import."
    Write-Host "Example: C:\Tools\DuckDB\duckdb.exe"
    $inputPath = Read-Host "duckdb.exe path"
    if ([string]::IsNullOrWhiteSpace($inputPath)) {
        Write-ErrorLine "DuckDB path missing. Install DuckDB or set FM_LAB_DUCKDB_EXE."
        Exit-WithErrorPause -Code 1
    }

    $trimmed = $inputPath.Trim('"').Trim()
    if (-not (Test-Path -LiteralPath $trimmed)) {
        Write-ErrorLine "duckdb.exe not found at: $trimmed"
        Exit-WithErrorPause -Code 1
    }

    $resolved = (Resolve-Path -LiteralPath $trimmed).Path
    $env:FM_LAB_DUCKDB_EXE = $resolved
    Write-LocalDuckDbPath -ProjectRoot $ProjectRoot -DuckDbPath $resolved
    Write-Info "DuckDB path saved locally in .fmlab\local-settings.json"
}

function Stop-RestApiProcesses {
    param([Parameter(Mandatory = $true)][int[]]$ApiPids)

    foreach ($processId in $ApiPids) {
        try {
            Stop-Process -Id $processId -Force -ErrorAction Stop
            Write-Info "Stopped REST API process PID $processId"
        } catch {
            Write-WarnLine "Could not stop REST API process PID $processId`: $($_.Exception.Message)"
        }
    }

    Start-Sleep -Seconds 1
}

function Request-StopApiForImport {
    param([string]$TargetDatabaseName = "the selected database")

    $apiPids = @(Get-ListenPids -Port 3003)
    if ($apiPids.Count -eq 0) {
        return
    }

    Write-Header "Database lock check"
    Write-WarnLine "The REST API is currently running on port 3003 and may lock the current DuckDB file."
    Write-Host "Selected import target: $TargetDatabaseName"
    $stopApi = Read-YesNoChoice -Prompt "Stop the REST API now so the selected database can be updated and used afterwards?" -DefaultYes $true
    if (-not $stopApi) {
        Write-WarnLine "Continuing without stopping the REST API. The final database sync may fail if the DB is locked."
        return
    }

    Stop-RestApiProcesses -ApiPids $apiPids
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

function Wait-ForPort {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [int]$Seconds = 5
    )

    for ($i = 0; $i -lt $Seconds; $i++) {
        if (@(Get-ListenPids -Port $Port).Count -gt 0) {
            return $true
        }
        Start-Sleep -Seconds 1
    }

    return $false
}

function Read-YesNoChoice {
    param(
        [Parameter(Mandatory = $true)][string]$Prompt,
        [bool]$DefaultYes = $false
    )

    $suffix = if ($DefaultYes) { "[Y/n]" } else { "[y/N]" }
    $choice = Read-Host "$Prompt $suffix"
    if ($null -eq $choice) {
        return $DefaultYes
    }

    $normalized = ([string]$choice).Trim().ToLowerInvariant()

    if ([string]::IsNullOrWhiteSpace($normalized)) {
        return $DefaultYes
    }

    return @("y", "yes", "j", "ja", "1", "true") -contains $normalized
}

function Format-ByteSize {
    param([long]$Bytes)

    if ($Bytes -ge 1GB) { return "{0:N2} GB" -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return "{0:N2} MB" -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return "{0:N2} KB" -f ($Bytes / 1KB) }
    return "$Bytes B"
}

function Show-XmlExportGuide {
    param([Parameter(Mandatory = $true)][string]$XmlDir)

    Write-Host "XML folder:"
    Write-Host "  $XmlDir"
    Write-Host ""
    Write-Host "To analyze your own FileMaker file later:"
    Write-Host "  1. Open the .fmp12 file in FileMaker Pro."
    Write-Host "  2. Use Tools > Save a Copy as XML."
    Write-Host "  3. Save the exported .xml file into the XML folder above."
    Write-Host "  4. Return to this PowerShell window and select the XML file."
    Write-Host ""

    if ([Environment]::UserInteractive) {
        $openXmlFolder = Read-YesNoChoice -Prompt "Open the XML folder in File Explorer now?" -DefaultYes $false
        if ($openXmlFolder) {
            Start-Process explorer.exe -ArgumentList @($XmlDir)
        }
    }
}

function Resolve-XmlImportSelection {
    param(
        [AllowNull()][object]$ExplicitChoice,
        [string]$ExplicitXml = "",
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$ApiDbPath
    )

    $xmlDir = Join-Path $ProjectRoot "xml"
    $xmlFiles = @(Get-ChildItem -LiteralPath $xmlDir -Filter "*.xml" -File -ErrorAction SilentlyContinue | Sort-Object Name)

    if (-not [string]::IsNullOrWhiteSpace($ExplicitXml)) {
        if ($ExplicitXml.Trim().ToLowerInvariant() -in @("all", "*", "batch")) {
            return [pscustomobject]@{ Mode = "all"; FileName = "" }
        }

        $matchedFile = $xmlFiles | Where-Object { $_.Name -ieq $ExplicitXml.Trim() } | Select-Object -First 1
        if (-not $matchedFile) {
            Write-ErrorLine "XML file not found in xml/: $ExplicitXml"
            Exit-WithErrorPause -Code 1
        }

        return [pscustomobject]@{ Mode = "file"; FileName = $matchedFile.Name }
    }

    if ($null -ne $ExplicitChoice) {
        if ([bool]$ExplicitChoice) {
            return [pscustomobject]@{ Mode = "all"; FileName = "" }
        }
        return [pscustomobject]@{ Mode = "skip"; FileName = "" }
    }

    if (-not [Environment]::UserInteractive) {
        return [pscustomobject]@{ Mode = "skip"; FileName = "" }
    }

    if ($xmlFiles.Count -eq 0) {
        $sampleXml = Join-Path $ProjectRoot "xml-test\Kontakte.xml"
        if ([Environment]::UserInteractive -and (Test-Path -LiteralPath $sampleXml)) {
            Write-Header "XML import"
            Write-WarnLine "No XML files were found in xml/."
            Show-XmlExportGuide -XmlDir $xmlDir
            $prepareSample = Read-YesNoChoice -Prompt "Use the bundled Kontakte example XML now?" -DefaultYes $true
            if ($prepareSample) {
                New-Item -ItemType Directory -Force -Path $xmlDir | Out-Null
                Copy-Item -LiteralPath $sampleXml -Destination (Join-Path $xmlDir "Kontakte.xml") -Force
                Write-Info "Prepared xml\\Kontakte.xml"
                $xmlFiles = @(Get-ChildItem -LiteralPath $xmlDir -Filter "*.xml" -File -ErrorAction SilentlyContinue | Sort-Object Name)
            }
        }

        if ($xmlFiles.Count -eq 0) {
            Write-WarnLine "No XML files found in xml/. Skipping XML import question."
            return [pscustomobject]@{ Mode = "skip"; FileName = "" }
        }
    }

    Write-Header "XML import"
    Write-Host "Found $($xmlFiles.Count) XML file(s) in xml/."
    Write-Host ""
    Show-XmlExportGuide -XmlDir $xmlDir
    Write-Host "  [0] Skip XML import"
    Write-Host "  [A] Import all XML files"
    for ($i = 0; $i -lt $xmlFiles.Count; $i++) {
        $entry = $xmlFiles[$i]
        Write-Host ("  [{0}] {1} ({2})" -f ($i + 1), $entry.Name, (Format-ByteSize -Bytes $entry.Length))
    }
    Write-Host ""

    $defaultValue = if (Test-Path -LiteralPath $ApiDbPath) { "0" } else { "A" }
    $defaultText = if ($defaultValue -eq "A") { "all XML files" } else { "skip import" }

    while ($true) {
        $choice = Read-Host "Selection 0, A, 1-$($xmlFiles.Count) or Enter for $defaultText"
        $normalized = $choice.Trim()
        if ([string]::IsNullOrWhiteSpace($normalized)) {
            $normalized = $defaultValue
        }

        switch ($normalized.ToLowerInvariant()) {
            "0" { return [pscustomobject]@{ Mode = "skip"; FileName = "" } }
            "n" { return [pscustomobject]@{ Mode = "skip"; FileName = "" } }
            "no" { return [pscustomobject]@{ Mode = "skip"; FileName = "" } }
            "skip" { return [pscustomobject]@{ Mode = "skip"; FileName = "" } }
            "a" { return [pscustomobject]@{ Mode = "all"; FileName = "" } }
            "all" { return [pscustomobject]@{ Mode = "all"; FileName = "" } }
            "*" { return [pscustomobject]@{ Mode = "all"; FileName = "" } }
        }

        $index = 0
        if ([int]::TryParse($normalized, [ref]$index) -and $index -ge 1 -and $index -le $xmlFiles.Count) {
            return [pscustomobject]@{ Mode = "file"; FileName = $xmlFiles[$index - 1].Name }
        }

        $matchedFile = $xmlFiles | Where-Object { $_.Name -ieq $normalized } | Select-Object -First 1
        if ($matchedFile) {
            return [pscustomobject]@{ Mode = "file"; FileName = $matchedFile.Name }
        }

        Write-WarnLine "Unknown XML selection '$choice'."
    }
}

function Resolve-WebsiteStartChoice {
    param([AllowNull()][object]$ExplicitChoice)

    if ($null -ne $ExplicitChoice) {
        return [bool]$ExplicitChoice
    }

    if (-not [Environment]::UserInteractive) {
        return $true
    }

    Write-Header "Website"
    return Read-YesNoChoice -Prompt "Start REST API and website after this?" -DefaultYes $true
}

function ConvertTo-SafeDatabaseSlug {
    param([Parameter(Mandatory = $true)][string]$Name)

    $slug = [System.IO.Path]::GetFileNameWithoutExtension($Name).ToLowerInvariant()
    $slug = [regex]::Replace($slug, '[^a-z0-9]+', '_').Trim('_')
    if ([string]::IsNullOrWhiteSpace($slug)) {
        $slug = "sample"
    }
    return $slug
}

function Resolve-DatabaseForXmlSelection {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)]$Selection
    )

    if ($Selection.Mode -eq "file") {
        $slug = ConvertTo-SafeDatabaseSlug -Name $Selection.FileName
        $dbName = "fm_$slug.duckdb"
    } else {
        $dbName = "fm_catalog.duckdb"
    }

    return [pscustomobject]@{
        Name = $dbName
        MasterDb = Join-Path $ProjectRoot "db\$dbName"
        RestApiDb = Join-Path $ProjectRoot "rest-api\db\$dbName"
        RestApiEnvPath = ".\db\$dbName"
    }
}

function New-DatabaseInfoFromRestApiDb {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$RestApiDbPath
    )

    $name = [System.IO.Path]::GetFileName($RestApiDbPath)
    return [pscustomobject]@{
        Name = $name
        MasterDb = Join-Path $ProjectRoot "db\$name"
        RestApiDb = $RestApiDbPath
        RestApiEnvPath = ".\db\$name"
    }
}

function Resolve-ExistingDatabaseSelection {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)]$CurrentDatabase
    )

    $restDbDir = Join-Path $ProjectRoot "rest-api\db"
    $preferredSmallDbNames = @("fm_kontakte.duckdb", "fm_contacts.duckdb", "fm_test.duckdb")
    $dbFiles = @(Get-ChildItem -LiteralPath $restDbDir -Filter "*.duckdb" -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne "fm_reference.duckdb" } |
        Sort-Object -Property @(
            @{ Expression = { if ($preferredSmallDbNames -contains $_.Name.ToLowerInvariant()) { 0 } elseif ($_.Name -ne "fm_catalog.duckdb") { 1 } else { 2 } }; Ascending = $true },
            @{ Expression = "LastWriteTime"; Descending = $true },
            @{ Expression = "Name"; Ascending = $true }
        ))

    if ($dbFiles.Count -eq 0) {
        return $CurrentDatabase
    }

    if ($dbFiles.Count -eq 1) {
        return New-DatabaseInfoFromRestApiDb -ProjectRoot $ProjectRoot -RestApiDbPath $dbFiles[0].FullName
    }

    $defaultIndex = 0
    for ($i = 0; $i -lt $dbFiles.Count; $i++) {
        if ($preferredSmallDbNames -contains $dbFiles[$i].Name.ToLowerInvariant()) {
            $defaultIndex = $i
            break
        }
    }

    if (-not [Environment]::UserInteractive) {
        return New-DatabaseInfoFromRestApiDb -ProjectRoot $ProjectRoot -RestApiDbPath $dbFiles[$defaultIndex].FullName
    }

    Write-Header "DuckDB database"
    Write-Host "No XML import selected. Choose which existing DuckDB database the website should use:"
    Write-Host ""
    for ($i = 0; $i -lt $dbFiles.Count; $i++) {
        $entry = $dbFiles[$i]
        Write-Host ("  [{0}] {1} ({2}, {3})" -f ($i + 1), $entry.Name, (Format-ByteSize -Bytes $entry.Length), $entry.LastWriteTime.ToString("yyyy-MM-dd HH:mm"))
    }
    Write-Host ""

    $defaultText = $dbFiles[$defaultIndex].Name
    while ($true) {
        $choice = Read-Host "Selection 1-$($dbFiles.Count) or Enter for $defaultText"
        $normalized = if ($null -eq $choice) { "" } else { ([string]$choice).Trim() }
        if ([string]::IsNullOrWhiteSpace($normalized)) {
            return New-DatabaseInfoFromRestApiDb -ProjectRoot $ProjectRoot -RestApiDbPath $dbFiles[$defaultIndex].FullName
        }

        $index = 0
        if ([int]::TryParse($normalized, [ref]$index) -and $index -ge 1 -and $index -le $dbFiles.Count) {
            return New-DatabaseInfoFromRestApiDb -ProjectRoot $ProjectRoot -RestApiDbPath $dbFiles[$index - 1].FullName
        }

        $matchedFile = $dbFiles | Where-Object { $_.Name -ieq $normalized } | Select-Object -First 1
        if ($matchedFile) {
            return New-DatabaseInfoFromRestApiDb -ProjectRoot $ProjectRoot -RestApiDbPath $matchedFile.FullName
        }

        Write-WarnLine "Unknown database selection '$choice'."
    }
}

function Open-FrontendInBrowser {
    param([string]$Url = "http://localhost:5173")

    try {
        Start-Process $Url | Out-Null
        Write-Info "Opened website: $Url"
    } catch {
        Write-WarnLine "Could not open website automatically: $($_.Exception.Message)"
        Write-Host "Open manually: $Url"
    }
}

function Invoke-XmlImport {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)]$Selection,
        [Parameter(Mandatory = $true)]$DatabaseInfo
    )

    $convertScript = Join-Path $ProjectRoot "tools\convert_fm_xml.ps1"
    if (-not (Test-Path -LiteralPath $convertScript)) {
        Write-ErrorLine "XML converter not found: $convertScript"
        Exit-WithErrorPause -Code 1
    }

    Write-Header "DuckDB XML Import"
    Write-Info "Import target database: $($DatabaseInfo.MasterDb)"

    $previousDbFile = $env:FM_LAB_DB_FILE
    $previousRestDbFile = $env:FM_LAB_REST_API_DB_FILE
    try {
        $env:FM_LAB_DB_FILE = $DatabaseInfo.MasterDb
        $env:FM_LAB_REST_API_DB_FILE = $DatabaseInfo.RestApiDb

        if ($Selection.Mode -eq "all") {
            & powershell -NoProfile -ExecutionPolicy Bypass -File $convertScript --batch
        } elseif ($Selection.Mode -eq "file") {
            & powershell -NoProfile -ExecutionPolicy Bypass -File $convertScript $Selection.FileName
        } else {
            return
        }
    } finally {
        $env:FM_LAB_DB_FILE = $previousDbFile
        $env:FM_LAB_REST_API_DB_FILE = $previousRestDbFile
    }

    if ($LASTEXITCODE -ne 0) {
        Write-ErrorLine "XML import failed with exit code $LASTEXITCODE."
        Exit-WithErrorPause -Code $LASTEXITCODE
    }
}

function Resolve-AiProviderChoice {
    param(
        [string]$ExplicitProvider = "",
        [bool]$SkipPrompt = $false
    )

    $current = if ($env:AI_PROVIDER) { $env:AI_PROVIDER } else { "openai" }
    if (-not [string]::IsNullOrWhiteSpace($ExplicitProvider)) {
        return $ExplicitProvider.Trim().ToLowerInvariant()
    }

    if ($SkipPrompt -or -not [Environment]::UserInteractive) {
        return $current.Trim().ToLowerInvariant()
    }

    Write-Header "AI provider"
    Write-Host "Choose the default AI provider for this server run:"
    Write-Host "  [1] Codex / OpenAI"
    Write-Host "  [2] Claude / Anthropic"
    Write-Host "  [3] Ollama"
    Write-Host ""

    $defaultLabel = switch ($current.Trim().ToLowerInvariant()) {
        "anthropic" { "Claude / Anthropic" }
        "ollama" { "Ollama" }
        default { "Codex / OpenAI" }
    }

    $choice = Read-Host "Selection 1-3 or Enter for $defaultLabel"
    switch ($choice.Trim().ToLowerInvariant()) {
        "" { return $current.Trim().ToLowerInvariant() }
        "1" { return "openai" }
        "codex" { return "openai" }
        "openai" { return "openai" }
        "2" { return "anthropic" }
        "claude" { return "anthropic" }
        "anthropic" { return "anthropic" }
        "3" { return "ollama" }
        "ollama" { return "ollama" }
        default {
            Write-WarnLine "Unknown provider selection '$choice'. Using $current."
            return $current.Trim().ToLowerInvariant()
        }
    }
}

$explicitProvider = ""
$skipProviderPrompt = $false
$explicitImportXml = $null
$explicitXml = ""
$explicitStartWebsite = $null
$openBrowser = $true

for ($i = 0; $i -lt $args.Count; $i++) {
    $arg = $args[$i]
    switch -Regex ($arg) {
        '^(--help|-h|/\?)$' {
            Show-Help
            exit 0
        }
        '^(--codex|-Codex)$' {
            $explicitProvider = "openai"
        }
        '^(--claude|-Claude)$' {
            $explicitProvider = "anthropic"
        }
        '^(--provider|-Provider)$' {
            if ($i + 1 -ge $args.Count) {
                Write-ErrorLine "--provider requires a provider id."
                exit 1
            }
            $i++
            $explicitProvider = $args[$i]
        }
        '^(--no-provider-prompt|-NoProviderPrompt)$' {
            $skipProviderPrompt = $true
        }
        '^(--import-xml|-ImportXml)$' {
            $explicitImportXml = $true
        }
        '^(--xml|--xml-file|-Xml|-XmlFile)$' {
            if ($i + 1 -ge $args.Count) {
                Write-ErrorLine "--xml requires an XML file name or 'all'."
                exit 1
            }
            $i++
            $explicitXml = $args[$i]
        }
        '^(--skip-import|--no-import|-SkipImport|-NoImport)$' {
            $explicitImportXml = $false
        }
        '^(--start-website|-StartWebsite)$' {
            $explicitStartWebsite = $true
        }
        '^(--no-start-website|--no-start|-NoStartWebsite|-NoStart)$' {
            $explicitStartWebsite = $false
        }
        '^(--open-browser|-OpenBrowser)$' {
            $openBrowser = $true
        }
        '^(--no-open-browser|-NoOpenBrowser)$' {
            $openBrowser = $false
        }
        default {
            Write-ErrorLine "Unknown flag: $arg"
            Show-Help
            exit 1
        }
    }
}

$projectRoot = Get-ProjectRoot
$logsDir = Join-Path $projectRoot "logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
Write-StartupCsvLog -LogsDir $logsDir -Arguments @($args)

Show-Logo -ProjectRoot $projectRoot

$defaultApiDb = Join-Path $projectRoot "rest-api\db\fm_catalog.duckdb"
$xmlImportSelection = Resolve-XmlImportSelection -ExplicitChoice $explicitImportXml -ExplicitXml $explicitXml -ProjectRoot $projectRoot -ApiDbPath $defaultApiDb
$apiDatabase = Resolve-DatabaseForXmlSelection -ProjectRoot $projectRoot -Selection $xmlImportSelection
$apiDb = $apiDatabase.RestApiDb

if ($xmlImportSelection.Mode -eq "skip") {
    $apiDatabase = Resolve-ExistingDatabaseSelection -ProjectRoot $projectRoot -CurrentDatabase $apiDatabase
    $apiDb = $apiDatabase.RestApiDb
}

if ($xmlImportSelection.Mode -ne "skip") {
    Ensure-DuckDbCliForImport -ProjectRoot $projectRoot
    Write-Info "Selected XML import: $(if ($xmlImportSelection.Mode -eq 'file') { $xmlImportSelection.FileName } else { 'all XML files' }) -> $($apiDatabase.Name)"
    Request-StopApiForImport -TargetDatabaseName $apiDatabase.Name
    Invoke-XmlImport -ProjectRoot $projectRoot -Selection $xmlImportSelection -DatabaseInfo $apiDatabase
} elseif (-not (Test-Path -LiteralPath $apiDb) -and (Test-Path -LiteralPath $defaultApiDb)) {
    $apiDatabase = [pscustomobject]@{
        Name = "fm_catalog.duckdb"
        MasterDb = Join-Path $projectRoot "db\fm_catalog.duckdb"
        RestApiDb = $defaultApiDb
        RestApiEnvPath = ".\db\fm_catalog.duckdb"
    }
    $apiDb = $apiDatabase.RestApiDb
}

$shouldStartWebsite = Resolve-WebsiteStartChoice -ExplicitChoice $explicitStartWebsite
if (-not $shouldStartWebsite) {
    Write-Info "Website start skipped."
    Write-Host "Start later with:"
    Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-FileMaker-Object-Browser.ps1 --skip-import --start-website"
    exit 0
}

$selectedProvider = Resolve-AiProviderChoice -ExplicitProvider $explicitProvider -SkipPrompt $skipProviderPrompt
$env:AI_PROVIDER = $selectedProvider
$env:DUCKDB_PATH = $apiDatabase.RestApiEnvPath
Write-Info "AI provider for this run: $selectedProvider"
Write-Info "DuckDB database for this run: $($apiDatabase.Name)"

$nodeRuntime = Ensure-NodeAndNpm
$nodeBin = $nodeRuntime.Node
$npmBin = $nodeRuntime.Npm
Ensure-NpmDependencies -ProjectRoot $projectRoot -NpmBin $npmBin

$apiStarted = $false
$frontendStarted = $false

Write-Header "REST-API (Port 3003)"

if (-not (Test-Path -LiteralPath $apiDb)) {
    Write-ErrorLine "Database not found: $apiDb"
    Write-ErrorLine "Import an XML file first, for example: .\Start-FileMaker-Object-Browser.ps1 --xml Kontakte.xml --start-website"
    Exit-WithErrorPause -Code 1
}

$apiPids = @(Get-ListenPids -Port 3003)
if ($apiPids.Count -gt 0) {
    Write-Info "REST-API already running (PID $($apiPids -join ', '))"
    if ([Environment]::UserInteractive) {
        $restartApi = Read-YesNoChoice -Prompt "Restart REST API now so it uses $($apiDatabase.Name) and AI_PROVIDER=$selectedProvider?" -DefaultYes $true
        if ($restartApi) {
            Stop-RestApiProcesses -ApiPids $apiPids
            $apiPids = @(Get-ListenPids -Port 3003)
        } else {
            Write-WarnLine "Keeping the existing REST API process. It may still use a previous database/provider."
        }
    } else {
        Write-WarnLine "REST API is already running. It may still use a previous database/provider."
    }
}

if ($apiPids.Count -eq 0) {
    $apiOut = Join-Path $logsDir "rest-api.out.log"
    $apiErr = Join-Path $logsDir "rest-api.err.log"
    $apiProcess = Start-Process -FilePath $nodeBin `
        -ArgumentList @("src/index.js") `
        -WorkingDirectory (Join-Path $projectRoot "rest-api") `
        -RedirectStandardOutput $apiOut `
        -RedirectStandardError $apiErr `
        -WindowStyle Hidden `
        -PassThru

    if (Wait-ForPort -Port 3003 -Seconds 5) {
        $apiPids = @(Get-ListenPids -Port 3003)
        Write-Info "REST-API started (PID $($apiPids -join ', '))"
        $apiStarted = $true
    } else {
        Write-ErrorLine "REST-API could not be started. Logs:"
        Write-Host "  $apiOut"
        Write-Host "  $apiErr"
        if ($apiProcess -and -not $apiProcess.HasExited) {
            Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
        }
        Exit-WithErrorPause -Code 1
    }
}

try {
    $apiVersion = Invoke-RestMethod -Uri "http://localhost:3003/api/version" -TimeoutSec 3
    $tableCount = if ($apiVersion.tableCount) { $apiVersion.tableCount } else { "?" }
    Write-Info "API responding; $tableCount tables loaded"
} catch {
    Write-WarnLine "API is listening, but /api/version did not respond"
}

Write-Header "Frontend (Port 5173)"

$viteCmd = Join-Path $projectRoot "node_modules\.bin\vite.cmd"
$viteShim = Join-Path $projectRoot "node_modules\.bin\vite"
if (-not (Test-Path -LiteralPath $viteCmd) -and -not (Test-Path -LiteralPath $viteShim)) {
    Write-ErrorLine "Vite not found. Run npm install in the project root."
    Exit-WithErrorPause -Code 1
}

$frontendPids = @(Get-ListenPids -Port 5173)
if ($frontendPids.Count -gt 0) {
    Write-Info "Frontend already running (PID $($frontendPids -join ', '))"
} else {
    $frontendOut = Join-Path $logsDir "frontend.out.log"
    $frontendErr = Join-Path $logsDir "frontend.err.log"
    $frontendProcess = Start-Process -FilePath $npmBin `
        -ArgumentList @("run", "dev") `
        -WorkingDirectory (Join-Path $projectRoot "apps\web") `
        -RedirectStandardOutput $frontendOut `
        -RedirectStandardError $frontendErr `
        -WindowStyle Hidden `
        -PassThru

    if (Wait-ForPort -Port 5173 -Seconds 8) {
        $frontendPids = @(Get-ListenPids -Port 5173)
        Write-Info "Frontend started (PID $($frontendPids -join ', '))"
        $frontendStarted = $true
    } else {
        Write-ErrorLine "Frontend could not be started. Logs:"
        Write-Host "  $frontendOut"
        Write-Host "  $frontendErr"
        if ($frontendProcess -and -not $frontendProcess.HasExited) {
            Stop-Process -Id $frontendProcess.Id -Force -ErrorAction SilentlyContinue
        }
        Exit-WithErrorPause -Code 1
    }
}

Write-Header "Status"
Write-Host "  REST-API:  http://localhost:3003  $(if ($apiStarted) { '(started)' } else { '(already running)' })"
Write-Host "  Frontend:  http://localhost:5173  $(if ($frontendStarted) { '(started)' } else { '(already running)' })"
Write-Host ""
Write-Host "  Stop:      powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\stop-servers.ps1"
Write-Host "  API logs:  logs/rest-api.out.log | logs/rest-api.err.log"
Write-Host "  FE logs:   logs/frontend.out.log | logs/frontend.err.log"

if ($openBrowser) {
    Open-FrontendInBrowser -Url "http://localhost:5173"
}

exit 0
