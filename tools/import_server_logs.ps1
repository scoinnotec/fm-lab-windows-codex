#Requires -Version 5.1
<#
.SYNOPSIS
Imports FileMaker Server TopCallStats logs into the fm-lab-windows-codex DuckDB catalog.

.DESCRIPTION
Reads TopCallStats*.log files from a copied/downloaded FileMaker Server Logs
folder, normalizes the tab-delimited rows, imports them into DuckDB, and builds
matching/optimization views for layouts and fields.

External programs and libraries:
- DuckDB CLI: https://duckdb.org/docs/installation/
  Install examples: winget search DuckDB; scoop install duckdb; choco install duckdb
- PowerShell 5.1+ or PowerShell 7+: https://learn.microsoft.com/powershell/

No Python packages are required.

Important:
Do not parse live FileMaker Server log files directly from the server Logs
folder while FileMaker Server is writing to them. Copy or download the files
first, then import the copied folder.
#>

[CmdletBinding()]
param(
    [string]$LogDir,
    [string]$DatabasePath,
    [switch]$ClearExisting,
    [switch]$NoSync,
    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Help {
    @"
fm-lab-windows-codex FileMaker Server log import

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\import_server_logs.ps1 -LogDir C:\Path\To\Copied\Logs
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\import_server_logs.ps1 -LogDir .\server-logs -ClearExisting

Defaults:
  LogDir:       .\server-logs or FM_LAB_SERVER_LOG_DIR when set
  DatabasePath: .\db\fm_catalog.duckdb

Imports:
  TopCallStats.log
  TopCallStats-old.log
  TopCallStats*.log

After import:
  - ServerTopCallLogRaw
  - ServerTopCallObjectMatches
  - ServerTopCallOptimizationSummary
  - ServerTopCallDashboard

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
    param([Parameter(Mandatory = $true)][string]$Value)
    return "'" + ($Value -replace "'", "''") + "'"
}

function Quote-SqlIdentifier {
    param([Parameter(Mandatory = $true)][string]$Value)
    return '"' + ($Value -replace '"', '""') + '"'
}

function Convert-ToDuckDbPath {
    param([Parameter(Mandatory = $true)][string]$Value)
    return ((Resolve-Path -LiteralPath $Value).Path -replace "\\", "/")
}

function Convert-ToInt64OrNull {
    param($Value)
    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    $clean = $text.Trim() -replace ",", ""
    $number = 0L
    if ([Int64]::TryParse($clean, [ref]$number)) { return $number }
    return $null
}

function Convert-ToDoubleOrNull {
    param($Value)
    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    $clean = $text.Trim()
    $number = 0.0
    $style = [Globalization.NumberStyles]::Float -bor [Globalization.NumberStyles]::AllowThousands
    $cultures = @([Globalization.CultureInfo]::InvariantCulture, [Globalization.CultureInfo]::GetCultureInfo("de-DE"))
    if ($clean.Contains(",") -and -not $clean.Contains(".")) {
        $cultures = @([Globalization.CultureInfo]::GetCultureInfo("de-DE"), [Globalization.CultureInfo]::InvariantCulture)
    }

    foreach ($culture in $cultures) {
        if ([Double]::TryParse($clean, $style, $culture, [ref]$number)) {
            return $number
        }
    }

    $fallback = $clean -replace ",", "."
    if ([Double]::TryParse($fallback, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$number)) {
        return $number
    }

    return $null
}

function Normalize-FileMakerFileName {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    return ($Value.Trim() -replace "\.fmp12$", "")
}

function Parse-Target {
    param([string]$Target)

    $result = [ordered]@{
        Target_File_Name   = $null
        Target_Table_ID    = $null
        Target_Field_ID    = $null
        Target_Layout_Name = $null
        Target_Script_ID   = $null
        Target_Kind        = "unknown"
    }

    if ([string]::IsNullOrWhiteSpace($Target)) {
        return [pscustomobject]$result
    }

    $trimmed = $Target.Trim()
    $fieldMatch = [regex]::Match($trimmed, "^(.+?)::(?:Table|Tabelle)\((\d+)\)::(?:Field definitions|FieldDefinitions|Felddefinitionen)\((\d+)\)$", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($fieldMatch.Success) {
        $result.Target_File_Name = Normalize-FileMakerFileName $fieldMatch.Groups[1].Value
        $result.Target_Table_ID = [Int64]$fieldMatch.Groups[2].Value
        $result.Target_Field_ID = [Int64]$fieldMatch.Groups[3].Value
        $result.Target_Kind = "field"
        return [pscustomobject]$result
    }

    $tableMatch = [regex]::Match($trimmed, "^(.+?)::(?:Table|Tabelle)\((\d+)\)(?:::(?:Records|Datensätze|Datensaetze))?$", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($tableMatch.Success) {
        $result.Target_File_Name = Normalize-FileMakerFileName $tableMatch.Groups[1].Value
        $result.Target_Table_ID = [Int64]$tableMatch.Groups[2].Value
        $result.Target_Kind = "table"
        return [pscustomobject]$result
    }

    $tableLayoutMatch = [regex]::Match($trimmed, "^(.+?)::(?:Table|Tabelle)\((\d+)\)::(.+)$", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($tableLayoutMatch.Success) {
        $result.Target_File_Name = Normalize-FileMakerFileName $tableLayoutMatch.Groups[1].Value
        $result.Target_Table_ID = [Int64]$tableLayoutMatch.Groups[2].Value
        $result.Target_Layout_Name = $tableLayoutMatch.Groups[3].Value.Trim()
        $result.Target_Kind = "layout"
        return [pscustomobject]$result
    }

    $scriptMatch = [regex]::Match($trimmed, "^(.+?)::(?:Script|Skript)\((\d+)\)$", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($scriptMatch.Success) {
        $result.Target_File_Name = Normalize-FileMakerFileName $scriptMatch.Groups[1].Value
        $result.Target_Script_ID = [Int64]$scriptMatch.Groups[2].Value
        $result.Target_Kind = "script"
        return [pscustomobject]$result
    }

    $layoutMatch = [regex]::Match($trimmed, "^(.+?)::(.+)$")
    if ($layoutMatch.Success) {
        $result.Target_File_Name = Normalize-FileMakerFileName $layoutMatch.Groups[1].Value
        $result.Target_Layout_Name = $layoutMatch.Groups[2].Value.Trim()
        $result.Target_Kind = "layout"
        return [pscustomobject]$result
    }

    $result.Target_File_Name = Normalize-FileMakerFileName $trimmed
    return [pscustomobject]$result
}

function Normalize-HeaderName {
    param([string]$Value)
    if ($null -eq $Value) { return "" }
    return ([string]$Value).Trim().ToLowerInvariant() -replace "[^a-z0-9]", ""
}

function New-HeaderMap {
    param([string[]]$Headers)
    $map = @{}
    for ($i = 0; $i -lt $Headers.Count; $i++) {
        $key = Normalize-HeaderName $Headers[$i]
        if (-not [string]::IsNullOrWhiteSpace($key) -and -not $map.ContainsKey($key)) {
            $map[$key] = $i
        }
    }
    return $map
}

function Get-TopCallHeaderNames {
    param([Parameter(Mandatory = $true)][System.IO.FileInfo]$File)

    $reader = [System.IO.StreamReader]::new($File.FullName, [System.Text.Encoding]::UTF8, $true)
    try {
        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            return [string[]]($line -split "`t", -1)
        }
    } finally {
        $reader.Dispose()
    }

    return @()
}

function Test-HeaderAlias {
    param(
        [Parameter(Mandatory = $true)]$HeaderMap,
        [Parameter(Mandatory = $true)][string[]]$Names
    )

    foreach ($name in $Names) {
        if ($HeaderMap.ContainsKey((Normalize-HeaderName $name))) {
            return $true
        }
    }

    return $false
}

function Get-ColumnExpression {
    param(
        [Parameter(Mandatory = $true)]$HeaderLookup,
        [Parameter(Mandatory = $true)][string[]]$Names
    )

    $columns = New-Object System.Collections.Generic.List[string]
    foreach ($name in $Names) {
        $key = Normalize-HeaderName $name
        if ($HeaderLookup.ContainsKey($key)) {
            $columns.Add("raw." + (Quote-SqlIdentifier $HeaderLookup[$key])) | Out-Null
        }
    }

    if ($columns.Count -eq 0) { return "NULL" }
    if ($columns.Count -eq 1) { return $columns[0] }
    return "COALESCE(" + ($columns -join ", ") + ")"
}

function Get-FieldValue {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string[]]$Fields,
        [Parameter(Mandatory = $true)]$HeaderMap,
        [Parameter(Mandatory = $true)][string[]]$Names
    )

    foreach ($name in $Names) {
        $key = Normalize-HeaderName $name
        if ($HeaderMap.ContainsKey($key)) {
            $index = [int]$HeaderMap[$key]
            if ($index -ge 0 -and $index -lt $Fields.Count) {
                return $Fields[$index]
            }
        }
    }
    return $null
}

function Convert-CsvField {
    param($Value)
    if ($null -eq $Value) { return "" }
    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) { return "" }
    return '"' + ($text -replace '"', '""') + '"'
}

function Write-CsvRow {
    param(
        [Parameter(Mandatory = $true)][System.IO.StreamWriter]$Writer,
        [Parameter(Mandatory = $true)][AllowNull()][object[]]$Values
    )
    $Writer.WriteLine(($Values | ForEach-Object { Convert-CsvField $_ }) -join ",")
}

function Write-TopCallRowsCsv {
    param(
        [Parameter(Mandatory = $true)][System.IO.FileInfo]$File,
        [Parameter(Mandatory = $true)][System.IO.StreamWriter]$Writer
    )

    $reader = [System.IO.StreamReader]::new($File.FullName, [System.Text.Encoding]::UTF8, $true)
    try {
        $headerLine = $reader.ReadLine()
        if ([string]::IsNullOrWhiteSpace($headerLine)) {
            return 0
        }

        $headers = [string[]]($headerLine -split "`t", -1)
        $headerMap = New-HeaderMap -Headers $headers
        $hasTimestamp = $false
        foreach ($candidate in @("Timestamp", "Zeitstempel")) {
            if ($headerMap.ContainsKey((Normalize-HeaderName $candidate))) {
                $hasTimestamp = $true
                break
            }
        }

        if (-not $hasTimestamp) {
            Write-WarnLine "Skipping file without TopCallStats header: $($File.Name)"
            return 0
        }

        $importedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        $rowNumber = 0
        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($line)) { continue }

            $fields = [string[]]($line -split "`t", -1)
            $rowNumber++
            $target = [string](Get-FieldValue -Fields $fields -HeaderMap $headerMap -Names @("Target", "Ziel"))
            $parsedTarget = Parse-Target $target
            $timestampText = [string](Get-FieldValue -Fields $fields -HeaderMap $headerMap -Names @("Timestamp", "Zeitstempel"))
            $startTime = Convert-ToDoubleOrNull (Get-FieldValue -Fields $fields -HeaderMap $headerMap -Names @("Start Time", "Start_Time", "Startzeit"))
            $endTime = Convert-ToDoubleOrNull (Get-FieldValue -Fields $fields -HeaderMap $headerMap -Names @("End Time", "End_Time", "Endzeit"))
            $totalElapsed = Convert-ToInt64OrNull (Get-FieldValue -Fields $fields -HeaderMap $headerMap -Names @("Total Elapsed", "Total_Elapsed", "Vergangen gesamt"))
            $operation = [string](Get-FieldValue -Fields $fields -HeaderMap $headerMap -Names @("Operation", "Vorgang"))
            $networkBytesIn = Convert-ToInt64OrNull (Get-FieldValue -Fields $fields -HeaderMap $headerMap -Names @("Network Bytes In", "Network_Bytes_In", "Netzwerk-Byte Ein"))
            $networkBytesOut = Convert-ToInt64OrNull (Get-FieldValue -Fields $fields -HeaderMap $headerMap -Names @("Network Bytes Out", "Network_Bytes_Out", "Netzwerk-Byte Aus"))
            $elapsedTime = Convert-ToInt64OrNull (Get-FieldValue -Fields $fields -HeaderMap $headerMap -Names @("Elapsed Time", "Elapsed_Time", "Verstrichene Zeit"))
            $waitTime = Convert-ToInt64OrNull (Get-FieldValue -Fields $fields -HeaderMap $headerMap -Names @("Wait Time", "Wait_Time", "Wartezeit"))
            $ioTime = Convert-ToInt64OrNull (Get-FieldValue -Fields $fields -HeaderMap $headerMap -Names @("I/O Time", "IO Time", "I_O_Time", "E/A-Zeit", "EA-Zeit"))
            $clientName = [string](Get-FieldValue -Fields $fields -HeaderMap $headerMap -Names @("Client Name", "Client", "Client-Name"))

            Write-CsvRow -Writer $Writer -Values @(
                $File.Name,
                $importedAt,
                $rowNumber,
                $timestampText,
                $startTime,
                $endTime,
                $totalElapsed,
                $operation,
                $target,
                $networkBytesIn,
                $networkBytesOut,
                $elapsedTime,
                $waitTime,
                $ioTime,
                $clientName,
                $parsedTarget.Target_File_Name,
                $parsedTarget.Target_Table_ID,
                $parsedTarget.Target_Field_ID,
                $parsedTarget.Target_Layout_Name,
                $parsedTarget.Target_Script_ID,
                $parsedTarget.Target_Kind
            )
        }

        return $rowNumber
    } finally {
        $reader.Dispose()
    }
}

$unboundArgs = @($MyInvocation.UnboundArguments)
if ($Help -or $unboundArgs -contains "--help" -or $unboundArgs -contains "-h" -or $unboundArgs -contains "/?") {
    Show-Help
    exit 0
}

$projectRoot = Get-ProjectRoot

if ([string]::IsNullOrWhiteSpace($LogDir)) {
    if (-not [string]::IsNullOrWhiteSpace($env:FM_LAB_SERVER_LOG_DIR)) {
        $LogDir = $env:FM_LAB_SERVER_LOG_DIR
    } else {
        $LogDir = Join-Path $projectRoot "server-logs"
    }
}

if ([string]::IsNullOrWhiteSpace($DatabasePath)) {
    $DatabasePath = Join-Path $projectRoot "db\fm_catalog.duckdb"
}

$logDirPath = (Resolve-Path -LiteralPath $LogDir).Path
$dbPath = (Resolve-Path -LiteralPath $DatabasePath).Path
$analysisSql = Join-Path $projectRoot "sql\create_server_log_analysis.sql"
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

if (-not (Test-Path -LiteralPath $analysisSql)) {
    Write-ErrorLine "Analysis SQL not found: $analysisSql"
    exit 1
}

$logFiles = @(Get-ChildItem -LiteralPath $logDirPath -File -Filter "TopCallStats*.log" | Sort-Object Name)
if ($logFiles.Count -eq 0) {
    Write-WarnLine "No TopCallStats*.log files found in $logDirPath"
    exit 0
}

$headerLookup = @{}
$validLogFiles = New-Object System.Collections.Generic.List[System.IO.FileInfo]
foreach ($file in $logFiles) {
    $headers = Get-TopCallHeaderNames -File $file
    $headerMap = New-HeaderMap -Headers $headers
    $hasTimestamp = Test-HeaderAlias -HeaderMap $headerMap -Names @("Timestamp", "Zeitstempel")
    $hasTarget = Test-HeaderAlias -HeaderMap $headerMap -Names @("Target", "Ziel")
    if (-not $hasTimestamp -or -not $hasTarget) {
        Write-WarnLine "Skipping file without TopCallStats header: $($file.Name)"
        continue
    }

    $validLogFiles.Add($file) | Out-Null
    foreach ($header in $headers) {
        $key = Normalize-HeaderName $header
        if (-not [string]::IsNullOrWhiteSpace($key) -and -not $headerLookup.ContainsKey($key)) {
            $headerLookup[$key] = $header
        }
    }
}

$logFiles = @($validLogFiles)
if ($logFiles.Count -eq 0) {
    Write-WarnLine "No readable TopCallStats rows found in $logDirPath"
    exit 0
}

Write-Host ""
Write-Host "FileMaker Server TopCallStats import"
Write-Host "  Logs:     $logDirPath"
Write-Host "  Database: $dbPath"
Write-Host "  DuckDB:   $duckDbBin"
Write-Host ""

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("fm-lab-server-logs-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

try {
    $setup = & $duckDbBin $dbPath -c ".read '$($analysisSql -replace "'", "''")'" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorLine "Failed to create server log analysis tables/views"
        $setup | Write-Host
        exit 1
    }

    $fileNames = @($logFiles | ForEach-Object { Escape-SqlString $_.Name })
    if ($ClearExisting) {
        $deleteSql = "DELETE FROM ServerTopCallLogRaw;"
    } else {
        $deleteSql = "DELETE FROM ServerTopCallLogRaw WHERE Log_File IN ($($fileNames -join ', '));"
    }

    $fileListSql = "[" + (($logFiles | ForEach-Object { Escape-SqlString (Convert-ToDuckDbPath $_.FullName) }) -join ", ") + "]"
    $timestampExpr = Get-ColumnExpression -HeaderLookup $headerLookup -Names @("Timestamp", "Zeitstempel")
    $startExpr = Get-ColumnExpression -HeaderLookup $headerLookup -Names @("Start Time", "Start_Time", "Startzeit")
    $endExpr = Get-ColumnExpression -HeaderLookup $headerLookup -Names @("End Time", "End_Time", "Endzeit")
    $totalElapsedExpr = Get-ColumnExpression -HeaderLookup $headerLookup -Names @("Total Elapsed", "Total_Elapsed", "Vergangen gesamt")
    $operationExpr = Get-ColumnExpression -HeaderLookup $headerLookup -Names @("Operation", "Vorgang")
    $targetExpr = Get-ColumnExpression -HeaderLookup $headerLookup -Names @("Target", "Ziel")
    $networkBytesInExpr = Get-ColumnExpression -HeaderLookup $headerLookup -Names @("Network Bytes In", "Network_Bytes_In", "Netzwerk-Byte Ein")
    $networkBytesOutExpr = Get-ColumnExpression -HeaderLookup $headerLookup -Names @("Network Bytes Out", "Network_Bytes_Out", "Netzwerk-Byte Aus")
    $elapsedExpr = Get-ColumnExpression -HeaderLookup $headerLookup -Names @("Elapsed Time", "Elapsed_Time", "Verstrichene Zeit")
    $waitExpr = Get-ColumnExpression -HeaderLookup $headerLookup -Names @("Wait Time", "Wait_Time", "Wartezeit")
    $ioExpr = Get-ColumnExpression -HeaderLookup $headerLookup -Names @("I/O Time", "IO Time", "I_O_Time", "E/A-Zeit", "EA-Zeit")
    $clientExpr = Get-ColumnExpression -HeaderLookup $headerLookup -Names @("Client Name", "Client", "Client-Name")

    $copySql = @"
$deleteSql

INSERT INTO ServerTopCallLogRaw (
    Log_File,
    Imported_At,
    Row_Number,
    Timestamp_Text,
    Start_Time,
    End_Time,
    Total_Elapsed_Microseconds,
    Operation,
    Target,
    Network_Bytes_In,
    Network_Bytes_Out,
    Elapsed_Time_Microseconds,
    Wait_Time_Microseconds,
    IO_Time_Microseconds,
    Client_Name,
    Target_File_Name,
    Target_Table_ID,
    Target_Field_ID,
    Target_Layout_Name,
    Target_Script_ID,
    Target_Kind
)
WITH raw AS (
    SELECT *
    FROM read_csv(
        $fileListSql,
        delim = '\t',
        header = true,
        all_varchar = true,
        union_by_name = true,
        filename = true,
        nullstr = ''
    )
),
normalized AS (
    SELECT
        regexp_extract(raw.filename, '[^/]+$', 0) AS Log_File,
        CURRENT_TIMESTAMP AS Imported_At,
        row_number() OVER (PARTITION BY raw.filename) AS Row_Number,
        $timestampExpr AS Timestamp_Text,
        try_cast(replace($startExpr, ',', '.') AS DOUBLE) AS Start_Time,
        try_cast(replace($endExpr, ',', '.') AS DOUBLE) AS End_Time,
        try_cast(replace($totalElapsedExpr, ',', '') AS BIGINT) AS Total_Elapsed_Microseconds,
        $operationExpr AS Operation,
        $targetExpr AS Target,
        try_cast(replace($networkBytesInExpr, ',', '') AS BIGINT) AS Network_Bytes_In,
        try_cast(replace($networkBytesOutExpr, ',', '') AS BIGINT) AS Network_Bytes_Out,
        try_cast(replace($elapsedExpr, ',', '') AS BIGINT) AS Elapsed_Time_Microseconds,
        try_cast(replace($waitExpr, ',', '') AS BIGINT) AS Wait_Time_Microseconds,
        try_cast(replace($ioExpr, ',', '') AS BIGINT) AS IO_Time_Microseconds,
        $clientExpr AS Client_Name
    FROM raw
),
parsed AS (
    SELECT
        *,
        regexp_matches(Target, '^(.+?)::(?:Table|Tabelle)\(([0-9]+)\)::(?:Field definitions|FieldDefinitions|Felddefinitionen)\(([0-9]+)\)$', 'i') AS Is_Field_Target,
        regexp_matches(Target, '^(.+?)::(?:Table|Tabelle)\(([0-9]+)\)(?:::(?:Records|Datensätze|Datensaetze))?$', 'i') AS Is_Table_Target,
        regexp_matches(Target, '^(.+?)::(?:Table|Tabelle)\(([0-9]+)\)::(.+)$', 'i') AS Is_Table_Layout_Target,
        regexp_matches(Target, '^(.+?)::(?:Script|Skript)\(([0-9]+)\)$', 'i') AS Is_Script_Target
    FROM normalized
)
SELECT
    Log_File,
    Imported_At,
    Row_Number,
    Timestamp_Text,
    Start_Time,
    End_Time,
    Total_Elapsed_Microseconds,
    Operation,
    Target,
    Network_Bytes_In,
    Network_Bytes_Out,
    Elapsed_Time_Microseconds,
    Wait_Time_Microseconds,
    IO_Time_Microseconds,
    Client_Name,
    regexp_replace(
        CASE
            WHEN Is_Field_Target THEN regexp_extract(Target, '^(.+?)::(?:Table|Tabelle)\(([0-9]+)\)::(?:Field definitions|FieldDefinitions|Felddefinitionen)\(([0-9]+)\)$', 1, 'i')
            WHEN Is_Table_Target THEN regexp_extract(Target, '^(.+?)::(?:Table|Tabelle)\(([0-9]+)\)(?:::(?:Records|Datensätze|Datensaetze))?$', 1, 'i')
            WHEN NOT Is_Field_Target AND NOT Is_Table_Target AND Is_Table_Layout_Target THEN regexp_extract(Target, '^(.+?)::(?:Table|Tabelle)\(([0-9]+)\)::(.+)$', 1, 'i')
            WHEN Is_Script_Target THEN regexp_extract(Target, '^(.+?)::(?:Script|Skript)\(([0-9]+)\)$', 1, 'i')
            WHEN regexp_matches(Target, '^.+?::.+$') THEN regexp_extract(Target, '^(.+?)::(.+)$', 1)
            ELSE Target
        END,
        '(?i)\.fmp12$',
        ''
    ) AS Target_File_Name,
    CASE
        WHEN Is_Field_Target THEN try_cast(regexp_extract(Target, '^(.+?)::(?:Table|Tabelle)\(([0-9]+)\)::(?:Field definitions|FieldDefinitions|Felddefinitionen)\(([0-9]+)\)$', 2, 'i') AS BIGINT)
        WHEN Is_Table_Target THEN try_cast(regexp_extract(Target, '^(.+?)::(?:Table|Tabelle)\(([0-9]+)\)(?:::(?:Records|Datensätze|Datensaetze))?$', 2, 'i') AS BIGINT)
        WHEN NOT Is_Field_Target AND NOT Is_Table_Target AND Is_Table_Layout_Target THEN try_cast(regexp_extract(Target, '^(.+?)::(?:Table|Tabelle)\(([0-9]+)\)::(.+)$', 2, 'i') AS BIGINT)
        ELSE NULL
    END AS Target_Table_ID,
    CASE
        WHEN Is_Field_Target THEN try_cast(regexp_extract(Target, '^(.+?)::(?:Table|Tabelle)\(([0-9]+)\)::(?:Field definitions|FieldDefinitions|Felddefinitionen)\(([0-9]+)\)$', 3, 'i') AS BIGINT)
        ELSE NULL
    END AS Target_Field_ID,
    CASE
        WHEN NOT Is_Field_Target AND NOT Is_Table_Target AND Is_Table_Layout_Target THEN regexp_extract(Target, '^(.+?)::(?:Table|Tabelle)\(([0-9]+)\)::(.+)$', 3, 'i')
        WHEN NOT Is_Field_Target AND NOT Is_Table_Target AND NOT Is_Script_Target AND regexp_matches(Target, '^.+?::.+$') THEN regexp_extract(Target, '^(.+?)::(.+)$', 2)
        ELSE NULL
    END AS Target_Layout_Name,
    CASE
        WHEN Is_Script_Target THEN try_cast(regexp_extract(Target, '^(.+?)::(?:Script|Skript)\(([0-9]+)\)$', 2, 'i') AS BIGINT)
        ELSE NULL
    END AS Target_Script_ID,
    CASE
        WHEN Is_Field_Target THEN 'field'
        WHEN Is_Table_Target THEN 'table'
        WHEN Is_Script_Target THEN 'script'
        WHEN regexp_matches(Target, '^.+?::.+$') THEN 'layout'
        ELSE 'unknown'
    END AS Target_Kind
FROM parsed;

.read '$($analysisSql -replace "'", "''")'
"@

    $sqlPath = Join-Path $tempDir "import_top_call_stats.sql"
    Set-Content -LiteralPath $sqlPath -Value $copySql -Encoding UTF8

    $importOutput = & $duckDbBin $dbPath -c ".read '$($sqlPath -replace "'", "''")'" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorLine "DuckDB import failed"
        $importOutput | Write-Host
        exit 1
    }

    $fileSummary = & $duckDbBin -readonly $dbPath -csv -c "SELECT Log_File, COUNT(*) AS Rows FROM ServerTopCallLogRaw WHERE Log_File IN ($($fileNames -join ', ')) GROUP BY Log_File ORDER BY Log_File" 2>&1
    $summary = & $duckDbBin -readonly $dbPath -csv -c "SELECT Metric_Label, Metric_Value FROM ServerTopCallDashboard ORDER BY Sort_Order" 2>&1
    Write-Host ""
    $fileSummary | Write-Host
    $summary | Write-Host

    if (-not $NoSync) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $restApiDb) | Out-Null
        try {
            Copy-Item -LiteralPath $dbPath -Destination $restApiDb -Force
            Write-Info "Synced database to rest-api\db\fm_catalog.duckdb"
        } catch {
            Write-WarnLine "Could not sync database to rest-api\db\fm_catalog.duckdb because the file is in use. Stop the REST server or rerun with -NoSync and copy later."
        }
    }
} finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
