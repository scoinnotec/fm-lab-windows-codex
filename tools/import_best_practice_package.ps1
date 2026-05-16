#Requires -Version 5.1
<#
.SYNOPSIS
Imports a FileMaker best-practice ZIP package into the fm-lab-windows-codex DuckDB catalog.

.DESCRIPTION
Reads one ZIP package containing a manifest, JSONL knowledge cards, optional
source rows, and Markdown documents. The script validates the package, creates
best-practice tables in the fm-lab-windows-codex catalog, replaces rows
for the same package_id, and writes query-friendly views.

External programs and libraries:
- DuckDB CLI: https://duckdb.org/docs/installation/
  Install examples: winget search DuckDB; scoop install duckdb; choco install duckdb
- PowerShell 5.1+ or PowerShell 7+: https://learn.microsoft.com/powershell/

No Python packages are required.
#>

[CmdletBinding()]
param(
    [string]$ZipPath,
    [string]$DatabasePath,
    [switch]$ClearExisting,
    [switch]$NoSync,
    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Help {
    @"
fm-lab-windows-codex best-practice package import

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\import_best_practice_package.ps1 -ZipPath C:\Path\To\fm-lab-best-practice-kanon.zip
  npm run import:best-practice -- -ZipPath C:\Path\To\fm-lab-best-practice-kanon.zip

Defaults:
  DatabasePath: .\db\fm_catalog.duckdb

Expected ZIP layout:
  manifest.json
  data/fm_lab_knowledge_cards.jsonl
  data/fm_lab_knowledge_sources.jsonl       optional
  docs/*.md                                 optional
  checks/SHA256SUMS.txt                     optional

Imported objects:
  BestPracticePackages
  BestPracticeKnowledgeCards
  BestPracticeKnowledgeSources
  BestPracticeDocuments
  BestPracticeKnowledgeCardsCurrent         view
  BestPracticeOptimizationTips              view

The database is synced to rest-api\db\fm_catalog.duckdb unless -NoSync is used.
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

function Resolve-Executable {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string[]]$Fallbacks = @()
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
        return $command.Source
    }

    foreach ($candidate in $Fallbacks) {
        $expanded = [Environment]::ExpandEnvironmentVariables($candidate)
        if (Test-Path -LiteralPath $expanded) {
            return $expanded
        }
    }

    return $null
}

function Escape-SqlString {
    param([AllowNull()][string]$Value)

    if ($null -eq $Value) {
        return "NULL"
    }

    return "'" + ($Value -replace "'", "''") + "'"
}

function Escape-SqlNumber {
    param([AllowNull()]$Value)

    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        return "NULL"
    }

    return [string][int]$Value
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json)
}

function Read-JsonlFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    $rows = New-Object System.Collections.Generic.List[object]
    $lineNumber = 0
    foreach ($line in Get-Content -LiteralPath $Path) {
        $lineNumber += 1
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        try {
            $rows.Add(($line | ConvertFrom-Json))
        } catch {
            throw "Invalid JSONL at $Path line $lineNumber. $($_.Exception.Message)"
        }
    }

    return $rows
}

function Get-ObjectValue {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $property = $Object.PSObject.Properties[$Name]
    if ($property) {
        return $property.Value
    }

    return $null
}

function Invoke-DuckDbSqlFile {
    param(
        [Parameter(Mandatory = $true)][string]$DuckDbBin,
        [Parameter(Mandatory = $true)][string]$DatabasePath,
        [Parameter(Mandatory = $true)][string]$SqlFilePath,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )

    $outputPath = Join-Path ([System.IO.Path]::GetTempPath()) ("fm-lab-best-practice-duckdb-" + [guid]::NewGuid().ToString("N") + ".log")
    $cmd = '""{0}" "{1}" < "{2}" > "{3}" 2>&1"' -f $DuckDbBin, $DatabasePath, $SqlFilePath, $outputPath

    Push-Location $WorkingDirectory
    try {
        cmd.exe /d /c $cmd
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    $output = ""
    if (Test-Path -LiteralPath $outputPath) {
        $output = Get-Content -LiteralPath $outputPath -Raw
        Remove-Item -LiteralPath $outputPath -Force -ErrorAction SilentlyContinue
    }

    if ($exitCode -ne 0) {
        throw "DuckDB import failed with exit code $exitCode. $output"
    }

    return $output
}

function Copy-DatabaseToRestApi {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$RestApiPath
    )

    $sourceFull = [System.IO.Path]::GetFullPath($SourcePath)
    $targetFull = [System.IO.Path]::GetFullPath($RestApiPath)
    if ([string]::Equals($sourceFull, $targetFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        return
    }

    $targetDir = Split-Path -Parent $targetFull
    if (-not (Test-Path -LiteralPath $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir | Out-Null
    }

    Copy-Item -LiteralPath $sourceFull -Destination $targetFull -Force
    Write-Info "Synced database to rest-api\db\fm_catalog.duckdb"
}

if ($Help) {
    Show-Help
    exit 0
}

if ([string]::IsNullOrWhiteSpace($ZipPath)) {
    Show-Help
    throw "ZipPath is required."
}

$projectRoot = Get-ProjectRoot

if ([string]::IsNullOrWhiteSpace($DatabasePath)) {
    $DatabasePath = Join-Path $projectRoot "db\fm_catalog.duckdb"
}

$databaseDir = Split-Path -Parent $DatabasePath
if (-not (Test-Path -LiteralPath $databaseDir)) {
    New-Item -ItemType Directory -Path $databaseDir | Out-Null
}

$dbPath = [System.IO.Path]::GetFullPath($DatabasePath)
$zipFullPath = (Resolve-Path -LiteralPath $ZipPath).Path
$restApiDb = Join-Path $projectRoot "rest-api\db\fm_catalog.duckdb"

$duckDbBin = Resolve-Executable -Name "duckdb" -Fallbacks @(
    "%LOCALAPPDATA%\Programs\DuckDB\duckdb.exe",
    "%USERPROFILE%\.duckdb\cli\latest\duckdb.exe",
    "C:\Program Files\DuckDB\duckdb.exe",
    "C:\Program Files (x86)\DuckDB\duckdb.exe"
)

if (-not $duckDbBin) {
    Write-ErrorLine "DuckDB CLI not found. Install it from https://duckdb.org/docs/installation/"
    exit 1
}

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("fm-lab-best-practice-" + [guid]::NewGuid().ToString("N"))
$extractDir = Join-Path $tempDir "package"
New-Item -ItemType Directory -Path $extractDir | Out-Null

try {
    Expand-Archive -LiteralPath $zipFullPath -DestinationPath $extractDir -Force

    $manifestPath = Join-Path $extractDir "manifest.json"
    $cardsPath = Join-Path $extractDir "data\fm_lab_knowledge_cards.jsonl"
    $sourcesPath = Join-Path $extractDir "data\fm_lab_knowledge_sources.jsonl"
    $docsDir = Join-Path $extractDir "docs"

    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw "Package is missing manifest.json."
    }
    if (-not (Test-Path -LiteralPath $cardsPath)) {
        throw "Package is missing data\fm_lab_knowledge_cards.jsonl."
    }

    $manifest = Read-JsonFile -Path $manifestPath
    if ((Get-ObjectValue -Object $manifest -Name "format") -ne "fm-lab-best-practice-package") {
        throw "Unsupported package format. Expected fm-lab-best-practice-package."
    }

    $packageId = [string](Get-ObjectValue -Object $manifest -Name "package_id")
    if ([string]::IsNullOrWhiteSpace($packageId)) {
        throw "manifest.json is missing package_id."
    }

    $cards = Read-JsonlFile -Path $cardsPath
    if ($cards.Count -eq 0) {
        throw "Package contains no knowledge cards."
    }

    $requiredCardFields = @("id", "theme", "check_signal", "recommendation", "why", "evidence_class", "author_or_tool", "status")
    foreach ($card in $cards) {
        foreach ($field in $requiredCardFields) {
            $value = Get-ObjectValue -Object $card -Name $field
            if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) {
                throw "Knowledge card is missing required field '$field'."
            }
        }
    }

    $sources = New-Object System.Collections.Generic.List[object]
    if (Test-Path -LiteralPath $sourcesPath) {
        $sources = Read-JsonlFile -Path $sourcesPath
    }

    $documents = New-Object System.Collections.Generic.List[object]
    if (Test-Path -LiteralPath $docsDir) {
        foreach ($doc in Get-ChildItem -LiteralPath $docsDir -File -Filter "*.md" | Sort-Object Name) {
            $documents.Add([pscustomobject]@{
                file_name = $doc.Name
                relative_path = "docs/$($doc.Name)"
                sha256 = (Get-FileHash -LiteralPath $doc.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                content = Get-Content -LiteralPath $doc.FullName -Raw
            })
        }
    }

    $zipHash = (Get-FileHash -LiteralPath $zipFullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $importedAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssK")
    $manifestJson = Get-Content -LiteralPath $manifestPath -Raw

    $sqlPath = Join-Path $tempDir "import_best_practice_package.sql"
    $sqlLines = New-Object System.Collections.Generic.List[string]

    $sqlLines.Add("BEGIN TRANSACTION;")
    $sqlLines.Add(@"
CREATE TABLE IF NOT EXISTS BestPracticePackages (
    package_id VARCHAR PRIMARY KEY,
    format_version VARCHAR,
    title VARCHAR,
    package_version VARCHAR,
    language VARCHAR,
    created_at VARCHAR,
    created_by VARCHAR,
    source_scope VARCHAR,
    source_zip_path VARCHAR,
    source_zip_sha256 VARCHAR,
    imported_at TIMESTAMP,
    manifest_json VARCHAR
);

CREATE TABLE IF NOT EXISTS BestPracticeKnowledgeCards (
    package_id VARCHAR,
    card_id VARCHAR,
    theme VARCHAR,
    check_signal VARCHAR,
    recommendation VARCHAR,
    why VARCHAR,
    apply_when VARCHAR,
    not_apply_when VARCHAR,
    evidence_class VARCHAR,
    author_or_tool VARCHAR,
    source_url VARCHAR,
    source_reference VARCHAR,
    local_source VARCHAR,
    status VARCHAR,
    priority INTEGER,
    language VARCHAR,
    imported_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS BestPracticeKnowledgeSources (
    package_id VARCHAR,
    source_id VARCHAR,
    title VARCHAR,
    author_or_tool VARCHAR,
    evidence_class VARCHAR,
    source_type VARCHAR,
    source_url VARCHAR,
    local_source VARCHAR,
    retrieval_date VARCHAR,
    notes VARCHAR,
    imported_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS BestPracticeDocuments (
    package_id VARCHAR,
    file_name VARCHAR,
    relative_path VARCHAR,
    sha256 VARCHAR,
    content VARCHAR,
    imported_at TIMESTAMP
);

"@)

    if ($ClearExisting) {
        $sqlLines.Add("DELETE FROM BestPracticeDocuments;")
        $sqlLines.Add("DELETE FROM BestPracticeKnowledgeSources;")
        $sqlLines.Add("DELETE FROM BestPracticeKnowledgeCards;")
        $sqlLines.Add("DELETE FROM BestPracticePackages;")
    } else {
        $packageSql = Escape-SqlString $packageId
        $sqlLines.Add("DELETE FROM BestPracticeDocuments WHERE package_id = $packageSql;")
        $sqlLines.Add("DELETE FROM BestPracticeKnowledgeSources WHERE package_id = $packageSql;")
        $sqlLines.Add("DELETE FROM BestPracticeKnowledgeCards WHERE package_id = $packageSql;")
        $sqlLines.Add("DELETE FROM BestPracticePackages WHERE package_id = $packageSql;")
    }

    $sqlLines.Add(("INSERT INTO BestPracticePackages VALUES ({0}, {1}, {2}, {3}, {4}, {5}, {6}, {7}, {8}, {9}, CAST({10} AS TIMESTAMP), {11});" -f `
        (Escape-SqlString $packageId), `
        (Escape-SqlString ([string](Get-ObjectValue -Object $manifest -Name "format_version"))), `
        (Escape-SqlString ([string](Get-ObjectValue -Object $manifest -Name "title"))), `
        (Escape-SqlString ([string](Get-ObjectValue -Object $manifest -Name "version"))), `
        (Escape-SqlString ([string](Get-ObjectValue -Object $manifest -Name "language"))), `
        (Escape-SqlString ([string](Get-ObjectValue -Object $manifest -Name "created_at"))), `
        (Escape-SqlString ([string](Get-ObjectValue -Object $manifest -Name "created_by"))), `
        (Escape-SqlString ([string](Get-ObjectValue -Object $manifest -Name "source_scope"))), `
        (Escape-SqlString $zipFullPath), `
        (Escape-SqlString $zipHash), `
        (Escape-SqlString $importedAt), `
        (Escape-SqlString $manifestJson)))

    foreach ($card in $cards) {
        $sqlLines.Add(("INSERT INTO BestPracticeKnowledgeCards VALUES ({0}, {1}, {2}, {3}, {4}, {5}, {6}, {7}, {8}, {9}, {10}, {11}, {12}, {13}, {14}, {15}, CAST({16} AS TIMESTAMP));" -f `
            (Escape-SqlString $packageId), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $card -Name "id"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $card -Name "theme"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $card -Name "check_signal"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $card -Name "recommendation"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $card -Name "why"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $card -Name "apply_when"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $card -Name "not_apply_when"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $card -Name "evidence_class"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $card -Name "author_or_tool"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $card -Name "source_url"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $card -Name "source_reference"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $card -Name "local_source"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $card -Name "status"))), `
            (Escape-SqlNumber (Get-ObjectValue -Object $card -Name "priority")), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $card -Name "language"))), `
            (Escape-SqlString $importedAt)))
    }

    foreach ($source in $sources) {
        $sqlLines.Add(("INSERT INTO BestPracticeKnowledgeSources VALUES ({0}, {1}, {2}, {3}, {4}, {5}, {6}, {7}, {8}, {9}, CAST({10} AS TIMESTAMP));" -f `
            (Escape-SqlString $packageId), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $source -Name "source_id"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $source -Name "title"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $source -Name "author_or_tool"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $source -Name "evidence_class"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $source -Name "source_type"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $source -Name "source_url"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $source -Name "local_source"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $source -Name "retrieval_date"))), `
            (Escape-SqlString ([string](Get-ObjectValue -Object $source -Name "notes"))), `
            (Escape-SqlString $importedAt)))
    }

    foreach ($document in $documents) {
        $sqlLines.Add(("INSERT INTO BestPracticeDocuments VALUES ({0}, {1}, {2}, {3}, {4}, CAST({5} AS TIMESTAMP));" -f `
            (Escape-SqlString $packageId), `
            (Escape-SqlString $document.file_name), `
            (Escape-SqlString $document.relative_path), `
            (Escape-SqlString $document.sha256), `
            (Escape-SqlString $document.content), `
            (Escape-SqlString $importedAt)))
    }

    $sqlLines.Add(@"
CREATE OR REPLACE VIEW BestPracticeKnowledgeCardsCurrent AS
SELECT
    c.*
FROM BestPracticeKnowledgeCards c
JOIN (
    SELECT package_id, MAX(imported_at) AS imported_at
    FROM BestPracticePackages
    GROUP BY package_id
) p
  ON p.package_id = c.package_id
 AND p.imported_at = c.imported_at;

CREATE OR REPLACE VIEW BestPracticeOptimizationTips AS
SELECT
    card_id,
    theme,
    priority,
    check_signal,
    recommendation,
    why,
    evidence_class,
    author_or_tool,
    source_url,
    source_reference,
    local_source,
    status,
    package_id,
    imported_at
FROM BestPracticeKnowledgeCardsCurrent
ORDER BY priority NULLS LAST, card_id;

COMMIT;
"@)

    Set-Content -LiteralPath $sqlPath -Value ($sqlLines -join [Environment]::NewLine) -Encoding UTF8

    $null = Invoke-DuckDbSqlFile -DuckDbBin $duckDbBin -DatabasePath $dbPath -SqlFilePath $sqlPath -WorkingDirectory $projectRoot

    Write-Info "Imported package $packageId"
    Write-Info ("Knowledge cards: {0}" -f $cards.Count)
    Write-Info ("Sources: {0}" -f $sources.Count)
    Write-Info ("Documents: {0}" -f $documents.Count)

    if (-not $NoSync) {
        try {
            Copy-DatabaseToRestApi -SourcePath $dbPath -RestApiPath $restApiDb
        } catch {
            Write-WarnLine "Could not sync database to rest-api\db\fm_catalog.duckdb. Stop the REST server or rerun with -NoSync and copy later. $($_.Exception.Message)"
        }
    }
} finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
