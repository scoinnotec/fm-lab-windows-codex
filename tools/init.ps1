#Requires -Version 5.1
<#
.SYNOPSIS
Initializes fm-lab-windows-codex on Windows for Codex-based workflows.

.DESCRIPTION
Checks external tools, installs npm dependencies, builds the shared package,
creates local .env files, optionally imports XML exports, and starts the REST
API plus web client. This is the Windows counterpart to tools/init.sh.

External programs and libraries:
- Node.js LTS and npm: https://nodejs.org/
  Install example: winget install OpenJS.NodeJS.LTS
- DuckDB CLI: https://duckdb.org/docs/installation/
  Install examples: winget search DuckDB; scoop install duckdb; choco install duckdb
- PowerShell 5.1+ or PowerShell 7+: https://learn.microsoft.com/powershell/

No Python packages are required.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Help {
    @"
fm-lab-windows-codex Windows/Codex initialization

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\init.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\init.ps1 --verbose
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\init.ps1 --skip-convert --no-start

Flags:
  --verbose       Show full npm output
  --skip-convert  Do not import XML files during setup
  --no-start      Do not start REST API and frontend after setup
  --help, -h      Show this help

XML input:
  Default: xml/ inside this repository
  Override: set FM_LAB_XML_DIR before running this script

External dependencies:
  Node.js LTS: https://nodejs.org/
  DuckDB CLI: https://duckdb.org/docs/installation/
  PowerShell: https://learn.microsoft.com/powershell/

Install hints:
  winget install OpenJS.NodeJS.LTS
  winget search DuckDB
  scoop install duckdb
  choco install duckdb
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

function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host $Message
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
    param(
        [Parameter(Mandatory = $true)][string[]]$Names,
        [string[]]$Fallbacks = @()
    )

    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) {
            return $command.Source
        }
    }

    foreach ($candidate in $Fallbacks) {
        $expanded = [Environment]::ExpandEnvironmentVariables($candidate)
        if (Test-Path -LiteralPath $expanded) {
            return $expanded
        }
    }

    return $null
}

function Get-DefaultXmlDir {
    if (-not [string]::IsNullOrWhiteSpace($env:FM_LAB_XML_DIR)) {
        return $env:FM_LAB_XML_DIR
    }

    return Join-Path (Get-ProjectRoot) "xml"
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [switch]$Silent
    )

    Push-Location $WorkingDirectory
    try {
        if ($Silent) {
            $output = & $FilePath @Arguments 2>&1
            if ($LASTEXITCODE -ne 0) {
                $output | Select-Object -Last 40 | ForEach-Object { Write-Host $_ }
                throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
            }
        } else {
            & $FilePath @Arguments
            if ($LASTEXITCODE -ne 0) {
                throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
            }
        }
    } finally {
        Pop-Location
    }
}

$verboseMode = $false
$skipConvert = $false
$noStart = $false

foreach ($arg in @($args)) {
    switch -Regex ($arg) {
        '^(--help|-h|/\?)$' {
            Show-Help
            exit 0
        }
        '^(--verbose|-v)$' {
            $verboseMode = $true
            continue
        }
        '^(--skip-convert|-SkipConvert)$' {
            $skipConvert = $true
            continue
        }
        '^(--no-start|-NoStart)$' {
            $noStart = $true
            continue
        }
        default {
            Write-ErrorLine "Unknown flag: $arg"
            Show-Help
            exit 1
        }
    }
}

$projectRoot = Get-ProjectRoot
$initStart = [System.Diagnostics.Stopwatch]::StartNew()
$summary = New-Object System.Collections.Generic.List[string]
$xmlDirForPrecheck = Get-DefaultXmlDir
New-Item -ItemType Directory -Force -Path $xmlDirForPrecheck | Out-Null
$xmlFilesForPrecheck = @(Get-ChildItem -LiteralPath $xmlDirForPrecheck -Filter "*.xml" -File -ErrorAction SilentlyContinue)
$duckDbRequired = (-not $skipConvert) -and ($xmlFilesForPrecheck.Count -gt 0)

Write-Header "fm-lab-windows-codex init (Windows/Codex)"
Write-Host "  Project root: $projectRoot"
if ($verboseMode) {
    Write-Host "  Mode: verbose"
}

Write-Header "Checking prerequisites"
$ok = $true

$duckDbBin = Resolve-Executable -Names @("duckdb") -Fallbacks @(
    "%LOCALAPPDATA%\Programs\DuckDB\duckdb.exe",
    "%USERPROFILE%\.duckdb\cli\latest\duckdb.exe",
    "C:\Program Files\DuckDB\duckdb.exe",
    "C:\Program Files (x86)\DuckDB\duckdb.exe"
)
if ($duckDbBin) {
    $duckVersion = (& $duckDbBin --version 2>$null | Select-Object -First 1)
    Write-Info "DuckDB: $duckVersion ($duckDbBin)"
} elseif ($duckDbRequired) {
    Write-ErrorLine "DuckDB CLI not found. Install it from https://duckdb.org/docs/installation/"
    $ok = $false
} else {
    Write-WarnLine "DuckDB CLI not found. XML conversion is skipped for this run; install DuckDB before importing XML."
}

$nodeBin = Resolve-Executable -Names @("node.exe", "node")
if ($nodeBin) {
    $nodeVersion = (& $nodeBin --version)
    $nodeMajor = [int](($nodeVersion -replace '^v', '') -split '\.')[0]
    if ($nodeMajor -ge 18) {
        Write-Info "Node.js: $nodeVersion"
    } else {
        Write-ErrorLine "Node.js $nodeVersion found, but >=18 is required."
        $ok = $false
    }
} else {
    Write-ErrorLine "Node.js not found. Install it from https://nodejs.org/"
    $ok = $false
}

$npmBin = Resolve-Executable -Names @("npm.cmd", "npm")
if ($npmBin) {
    $npmVersion = (& $npmBin --version)
    $npmMajor = [int](($npmVersion -split '\.')[0])
    if ($npmMajor -ge 9) {
        Write-Info "npm: $npmVersion"
    } else {
        Write-ErrorLine "npm $npmVersion found, but >=9 is required. Run: npm install -g npm"
        $ok = $false
    }
} else {
    Write-ErrorLine "npm not found."
    $ok = $false
}

if (-not $ok) {
    Write-Host ""
    Write-ErrorLine "Prerequisites missing. Install the tools above and run init.ps1 again."
    exit 1
}

Write-Header "Installing dependencies"
$installWatch = [System.Diagnostics.Stopwatch]::StartNew()
if ($verboseMode) {
    Invoke-CheckedCommand -FilePath $npmBin -Arguments @("install") -WorkingDirectory $projectRoot
} else {
    Invoke-CheckedCommand -FilePath $npmBin -Arguments @("install", "--silent") -WorkingDirectory $projectRoot -Silent
}
$installWatch.Stop()

$nodeModulesPath = Join-Path $projectRoot "node_modules"
$packageCount = 0
if (Test-Path -LiteralPath $nodeModulesPath) {
    $packageCount = @(Get-ChildItem -LiteralPath $nodeModulesPath -Directory -ErrorAction SilentlyContinue).Count
}
Write-Info "Dependencies installed (~$packageCount packages, $([int]$installWatch.Elapsed.TotalSeconds)s)"
$summary.Add("npm install       ~$packageCount packages ($([int]$installWatch.Elapsed.TotalSeconds)s)")

Write-Header "Building shared package"
$buildWatch = [System.Diagnostics.Stopwatch]::StartNew()
if ($verboseMode) {
    Invoke-CheckedCommand -FilePath $npmBin -Arguments @("run", "build:shared") -WorkingDirectory $projectRoot
} else {
    Invoke-CheckedCommand -FilePath $npmBin -Arguments @("run", "build:shared", "--silent") -WorkingDirectory $projectRoot -Silent
}
$buildWatch.Stop()
Write-Info "packages/shared built ($([int]$buildWatch.Elapsed.TotalSeconds)s)"
$summary.Add("packages/shared   TypeScript -> dist/ ($([int]$buildWatch.Elapsed.TotalSeconds)s)")

Write-Header "Environment files"
$envCreated = New-Object System.Collections.Generic.List[string]

$restEnv = Join-Path $projectRoot "rest-api\.env"
$restEnvExample = Join-Path $projectRoot "rest-api\.env.example"
if (-not (Test-Path -LiteralPath $restEnv)) {
    Copy-Item -LiteralPath $restEnvExample -Destination $restEnv
    Write-Info "Created rest-api/.env"
    $envCreated.Add("rest-api/.env")
} else {
    Write-Info "rest-api/.env already exists"
}

$webEnv = Join-Path $projectRoot "apps\web\.env"
$webEnvExample = Join-Path $projectRoot "apps\web\.env.example"
if (-not (Test-Path -LiteralPath $webEnv)) {
    Copy-Item -LiteralPath $webEnvExample -Destination $webEnv
    Write-Info "Created apps/web/.env"
    $envCreated.Add("apps/web/.env")
} else {
    Write-Info "apps/web/.env already exists"
}

if ($envCreated.Count -gt 0) {
    $summary.Add("env files         created: $($envCreated -join ', ')")
} else {
    $summary.Add("env files         already present")
}

New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot "logs") | Out-Null

Write-Header "FileMaker XML export"
$xmlDir = Get-DefaultXmlDir
New-Item -ItemType Directory -Force -Path $xmlDir | Out-Null
$xmlFiles = @(Get-ChildItem -LiteralPath $xmlDir -Filter "*.xml" -File -ErrorAction SilentlyContinue)

if ($skipConvert) {
    Write-WarnLine "XML conversion skipped (--skip-convert)"
    $summary.Add("XML conversion    skipped by flag")
} elseif ($xmlFiles.Count -eq 0) {
    Write-WarnLine "No XML files found in $xmlDir."
    $summary.Add("XML conversion    skipped (no files in configured XML directory)")
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  1. Export your FileMaker solution via Tools > Save a Copy As XML with Include details for analysis tools."
    Write-Host "  2. Place the .xml file(s) in $xmlDir"
    Write-Host "  3. Run: powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\convert_fm_xml.ps1 --batch"
    Write-Host "  4. Run: powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-servers.ps1"
    $noStart = $true
} else {
    Write-Info "Found $($xmlFiles.Count) XML file(s) in $xmlDir; starting conversion"
    $convertWatch = [System.Diagnostics.Stopwatch]::StartNew()
    & (Join-Path $PSScriptRoot "convert_fm_xml.ps1") --batch
    if ($LASTEXITCODE -ne 0) {
        throw "XML conversion failed with exit code $LASTEXITCODE"
    }
    $convertWatch.Stop()
    $summary.Add("XML conversion    $($xmlFiles.Count) file(s) -> fm_catalog.duckdb ($([int]$convertWatch.Elapsed.TotalSeconds)s)")
}

if (-not $noStart) {
    Write-Header "Starting servers"
    & (Join-Path $PSScriptRoot "start-servers.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "Server start failed with exit code $LASTEXITCODE"
    }
    $summary.Add("servers started   http://localhost:3003 | http://localhost:5173")
}

$initStart.Stop()
Write-Host ""
Write-Host "========================================"
Write-Host "fm-lab-windows-codex setup complete ($([int]$initStart.Elapsed.TotalSeconds)s)"
Write-Host ""
foreach ($line in $summary) {
    Write-Host "  [OK] $line"
}
Write-Host "========================================"

if (-not $noStart) {
    Write-Host ""
    Write-Host "Web Client:  http://localhost:5173"
    Write-Host "REST API:    http://localhost:3003"
}
