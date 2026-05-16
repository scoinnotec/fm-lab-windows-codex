#Requires -Version 5.1
<#
.SYNOPSIS
Prepares the bundled Kontakte XML example in the normal xml/ folder.

.DESCRIPTION
Copies xml-test/Kontakte.xml to xml/Kontakte.xml and optionally imports it with
tools/convert_fm_xml.ps1. This gives Windows users a small neutral example in
the same folder that normal FileMaker XML exports use.

External programs and libraries:
- PowerShell 5.1+ or PowerShell 7+: https://learn.microsoft.com/powershell/
- Optional for --import: DuckDB CLI: https://duckdb.org/docs/installation/

No Python packages are required.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Help {
    @"
fm-lab-windows-codex sample XML helper

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\open-sample-xml.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\open-sample-xml.ps1 --import
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\open-sample-xml.ps1 --import --start
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\open-sample-xml.ps1 --source C:\Path\To\Example.xml
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\open-sample-xml.ps1 --source .\xml --import

What it does:
  Default source: xml-test\Kontakte.xml
  Default target: xml\Kontakte.xml

Flags:
  --source <path>  XML file to copy into xml/, or an XML folder to open/import
  --import         Import the prepared XML file, or import all XML files from a source folder
  --start          Start REST API and web frontend after import
  --open-file      Open the XML file with the Windows default application
  --no-explorer    Do not open File Explorer
  --force          Overwrite an existing xml\Kontakte.xml or copied target file
  --help, -h       Show this help

Notes:
  Single XML imports create a small dedicated database such as db\fm_kontakte.duckdb.
  The npm run test:xml command uses xml-test/ and db/fm_test.duckdb.
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

function Resolve-InputPath {
    param([Parameter(Mandatory = $true)][string]$PathValue)

    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return $PathValue
    }

    return Join-Path (Get-Location).Path $PathValue
}

function Invoke-CheckedScript {
    param(
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [hashtable]$Environment = @{}
    )

    $previousValues = @{}
    foreach ($key in $Environment.Keys) {
        $previousValues[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
        [Environment]::SetEnvironmentVariable($key, [string]$Environment[$key], "Process")
    }

    try {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Script failed with exit code $LASTEXITCODE`: $ScriptPath"
        }
    } finally {
        foreach ($key in $Environment.Keys) {
            [Environment]::SetEnvironmentVariable($key, $previousValues[$key], "Process")
        }
    }
}

$doImport = $false
$doStart = $false
$openFile = $false
$noExplorer = $false
$force = $false
$source = ""

for ($i = 0; $i -lt $args.Count; $i++) {
    $arg = $args[$i]
    switch -Regex ($arg) {
        '^(--help|-h|-Help)$' {
            Show-Help
            exit 0
        }
        '^(--import|-Import)$' {
            $doImport = $true
        }
        '^(--start|-Start)$' {
            $doStart = $true
        }
        '^(--open-file|-OpenFile)$' {
            $openFile = $true
        }
        '^(--no-explorer|-NoExplorer)$' {
            $noExplorer = $true
        }
        '^(--force|-Force)$' {
            $force = $true
        }
        '^(--source|-Source)$' {
            if ($i + 1 -ge $args.Count) {
                Write-ErrorLine "--source requires a file or folder path."
                exit 1
            }
            $i++
            $source = $args[$i]
        }
        default {
            if ($arg.StartsWith("-")) {
                Write-ErrorLine "Unknown flag: $arg"
                Show-Help
                exit 1
            }
            if (-not [string]::IsNullOrWhiteSpace($source)) {
                Write-ErrorLine "Multiple source paths provided."
                exit 1
            }
            $source = $arg
        }
    }
}

$projectRoot = Get-ProjectRoot
$xmlDir = Join-Path $projectRoot "xml"
$defaultSource = Join-Path $projectRoot "xml-test\Kontakte.xml"
$convertScript = Join-Path $projectRoot "tools\convert_fm_xml.ps1"
$startScript = Join-Path $projectRoot "tools\start-servers.ps1"

if ([string]::IsNullOrWhiteSpace($source)) {
    $sourcePath = $defaultSource
} else {
    $sourcePath = Resolve-InputPath -PathValue $source
}

if (-not (Test-Path -LiteralPath $sourcePath)) {
    Write-ErrorLine "Source path not found: $sourcePath"
    exit 1
}

New-Item -ItemType Directory -Force -Path $xmlDir | Out-Null

$sourceItem = Get-Item -LiteralPath $sourcePath

if ($sourceItem.PSIsContainer) {
    $folder = $sourceItem.FullName
    Write-Info "Using XML folder: $folder"

    if (-not $noExplorer) {
        Start-Process explorer.exe -ArgumentList @($folder)
    }

    if ($doImport) {
        Invoke-CheckedScript -ScriptPath $convertScript -Arguments @("--batch") -Environment @{ FM_LAB_XML_DIR = $folder }
    } else {
        Write-Host "Import later with:"
        Write-Host "  `$env:FM_LAB_XML_DIR = `"$folder`""
        Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\convert_fm_xml.ps1 --batch"
    }
} else {
    if ($sourceItem.Extension -ne ".xml") {
        Write-ErrorLine "Source file must be a .xml file: $($sourceItem.FullName)"
        exit 1
    }

    $targetName = if ($sourceItem.FullName -eq (Resolve-Path -LiteralPath $defaultSource).Path) { "Kontakte.xml" } else { $sourceItem.Name }
    $targetPath = Join-Path $xmlDir $targetName

    if ((Test-Path -LiteralPath $targetPath) -and -not $force) {
        Write-WarnLine "Target already exists and was kept: $targetPath"
        Write-WarnLine "Use --force to overwrite it."
    } else {
        Copy-Item -LiteralPath $sourceItem.FullName -Destination $targetPath -Force
        Write-Info "Prepared example XML: $targetPath"
    }

    if (-not $noExplorer) {
        Start-Process explorer.exe -ArgumentList @("/select,`"$targetPath`"")
    }

    if ($openFile) {
        Start-Process -FilePath $targetPath
    }

    if ($doImport) {
        Invoke-CheckedScript -ScriptPath $convertScript -Arguments @($targetName)
    } else {
        Write-Host "Import later with:"
        Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\convert_fm_xml.ps1 $targetName"
    }
}

if ($doStart) {
    if (-not $doImport) {
        Write-WarnLine "--start was used without --import. Existing selected DuckDB database must already exist."
    }
    Invoke-CheckedScript -ScriptPath $startScript -Arguments @()
}
