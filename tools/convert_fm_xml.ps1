#Requires -Version 5.1
<#
.SYNOPSIS
Converts FileMaker Save-as-XML exports to the fm-lab-windows-codex DuckDB catalog on Windows.

.DESCRIPTION
This is the Windows/Codex port of tools/convert_fm_xml.sh. It avoids bash-only
tools such as file, iconv, tr, sed, md5sum, lsof and curl. The script keeps the
same conversion model: XML files are normalized into a temporary UTF-8 copy,
cleaned for DuckDB's XML reader, imported through sql/convert_xml.sql, and then
the universal catalogs are rebuilt in batch mode.

External programs and libraries:
- DuckDB CLI: https://duckdb.org/docs/installation/
  Install examples: winget search DuckDB; scoop install duckdb; choco install duckdb
- PowerShell 5.1+ or PowerShell 7+: https://learn.microsoft.com/powershell/

No Python packages are required.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Help {
    @"
fm-lab-windows-codex XML conversion for Windows/Codex

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\convert_fm_xml.ps1 <xml-filename>
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\convert_fm_xml.ps1 --batch
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\convert_fm_xml.ps1 --batch --force-rebuild
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\convert_fm_xml.ps1 --test --fail-fast

Flags:
  --batch, --all       Import all XML files from the configured XML input directory
  --test               Import all XML files from xml-test/ into db/fm_test.duckdb
  --fail-fast          Stop batch/test mode on the first failed file
  --force-rebuild      Delete the target DB before importing
  --no-auto-heal       Abort on schema drift instead of rebuilding in batch mode
  --help, -h           Show this help

XML input:
  Default: xml/ inside this repository
  Override: set FM_LAB_XML_DIR before running this script
  Files larger than 1 GB are split into temporary XML segments.
  Very large catalogs are split again into smaller part files before DuckDB import.
  Default part target: 32 MB.
  Override part target: set FM_LAB_XML_SEGMENT_MB to a positive whole-number MB value.
  Default LayoutCatalog part item target: 5 direct layout entries.
  Override LayoutCatalog item target: set FM_LAB_XML_SEGMENT_ITEMS to a positive whole-number value.
  Large LayoutCatalog imports use a .NET streaming extractor by default because
  DuckDB XML/XPath parsing can exceed 50 GB RAM on very large FileMaker DDR files.
  Large StepsForScripts imports use the same streaming approach because the XML
  XPath path is very slow on large script-step catalogs.
  Disable only for diagnostics: set FM_LAB_STREAM_LAYOUTS=0 or FM_LAB_STREAM_STEPS=0.

External dependencies:
  DuckDB CLI: https://duckdb.org/docs/installation/
  PowerShell: https://learn.microsoft.com/powershell/

Install hints:
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
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }
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

function Get-LocalDuckDbPath {
    $settingsPath = Join-Path (Get-ProjectRoot) ".fmlab\local-settings.json"
    if (-not (Test-Path -LiteralPath $settingsPath)) {
        return ""
    }

    try {
        $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
        if ($settings.duckdb_exe) {
            return [string]$settings.duckdb_exe
        }
    } catch {
        Write-WarnLine "Ignoring unreadable local settings file: $settingsPath"
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

function Resolve-DuckDbCli {
    $localDuckDb = Get-LocalDuckDbPath
    $commonWindowsDuckDb = Find-DuckDbInCommonWindowsDirs
    $candidatePaths = @(
        $env:FM_LAB_DUCKDB_EXE,
        $env:DUCKDB_EXE,
        $localDuckDb,
        $commonWindowsDuckDb,
        (Join-Path $script:ProjectRoot "duckdb\duckdb.exe"),
        (Join-Path $script:ProjectRoot "tools\duckdb\duckdb.exe"),
        "%LOCALAPPDATA%\Programs\DuckDB\duckdb.exe",
        "%USERPROFILE%\.duckdb\cli\latest\duckdb.exe",
        "C:\Program Files\DuckDB\duckdb.exe",
        "C:\Program Files (x86)\DuckDB\duckdb.exe"
    )

    return Resolve-Executable -Name "duckdb" -Fallbacks $candidatePaths
}

function Resolve-ConfiguredPath {
    param(
        [string]$ConfiguredPath = "",
        [Parameter(Mandatory = $true)][string]$DefaultPath
    )

    if ([string]::IsNullOrWhiteSpace($ConfiguredPath)) {
        return $DefaultPath
    }

    if ([System.IO.Path]::IsPathRooted($ConfiguredPath)) {
        return $ConfiguredPath
    }

    return Join-Path $script:ProjectRoot $ConfiguredPath
}

function Quote-NativeArgument {
    param([Parameter(Mandatory = $true)][string]$Value)
    return '"' + ($Value -replace '"', '\"') + '"'
}

function Get-ConcatenatedFileMd5 {
    param([Parameter(Mandatory = $true)][string[]]$Paths)

    $md5 = [System.Security.Cryptography.MD5]::Create()
    try {
        foreach ($path in $Paths) {
            $stream = [System.IO.File]::OpenRead($path)
            try {
                $buffer = New-Object byte[] 1048576
                while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $null = $md5.TransformBlock($buffer, 0, $read, $null, 0)
                }
            } finally {
                $stream.Dispose()
            }
        }

        $empty = New-Object byte[] 0
        $null = $md5.TransformFinalBlock($empty, 0, 0)
        return (($md5.Hash | ForEach-Object { $_.ToString("x2") }) -join "")
    } finally {
        $md5.Dispose()
    }
}

function Read-TemplateSchemaInfo {
    if (-not (Test-Path -LiteralPath $script:SqlTemplate)) {
        throw "SQL template not found: $script:SqlTemplate"
    }

    $versionLine = Select-String -LiteralPath $script:SqlTemplate -Pattern '^-- @SCHEMA_VERSION ' -List
    $hashLine = Select-String -LiteralPath $script:SqlTemplate -Pattern '^-- @SCHEMA_HASH_FILES ' -List

    if (-not $versionLine -or -not $hashLine) {
        throw "SQL template is missing @SCHEMA_VERSION or @SCHEMA_HASH_FILES in its header: $script:SqlTemplate"
    }

    $script:SchemaVersionExpected = (($versionLine.Line -split '\s+') | Select-Object -Index 2)
    $hashFilesRaw = $hashLine.Line -replace '^-- @SCHEMA_HASH_FILES\s+', ''
    $hashFiles = @($hashFilesRaw -split '\s+' | Where-Object { $_ })

    $absolutePaths = @()
    foreach ($file in $hashFiles) {
        $path = Join-Path $script:ProjectRoot $file
        if (-not (Test-Path -LiteralPath $path)) {
            throw "SQL template hash reference is missing: $path"
        }
        $absolutePaths += $path
    }

    $script:SchemaHashExpected = Get-ConcatenatedFileMd5 -Paths $absolutePaths
}

function Read-DbSchemaInfo {
    $script:SchemaVersionDb = ""
    $script:SchemaHashDb = ""

    if (-not (Test-Path -LiteralPath $script:DbFile)) {
        return
    }

    $query = "SELECT Schema_Version, Schema_Hash FROM SchemaInfo ORDER BY Schema_Built_At DESC LIMIT 1"
    $row = ""
    try {
        $row = & $script:DuckDbBin -readonly $script:DbFile -csv -noheader -c $query 2>$null | Select-Object -First 1
    } catch {
        $row = ""
    }

    if (-not [string]::IsNullOrWhiteSpace($row)) {
        $parts = $row -split ',', 2
        $script:SchemaVersionDb = $parts[0]
        if ($parts.Count -gt 1) {
            $script:SchemaHashDb = $parts[1]
        }
    }
}

function Compute-SchemaState {
    Read-TemplateSchemaInfo
    Read-DbSchemaInfo

    if (-not (Test-Path -LiteralPath $script:DbFile)) {
        $script:SchemaAction = "fresh_build"
        $script:SchemaReason = "DB file does not exist; normal first import"
    } elseif ([string]::IsNullOrWhiteSpace($script:SchemaVersionDb)) {
        $script:SchemaAction = "rebuild"
        $script:SchemaReason = "DB has no SchemaInfo table or could not be read"
    } elseif ($script:SchemaVersionDb -ne $script:SchemaVersionExpected) {
        $script:SchemaAction = "rebuild"
        $script:SchemaReason = "Schema version $script:SchemaVersionDb -> $script:SchemaVersionExpected"
    } elseif ($script:SchemaHashDb -ne $script:SchemaHashExpected) {
        $script:SchemaAction = "warn"
        $script:SchemaReason = "Schema hash drift detected; rebuild recommended with --force-rebuild"
    } else {
        $script:SchemaAction = "incremental"
        $script:SchemaReason = "Schema OK (v$script:SchemaVersionDb)"
    }
}

function Remove-DbForRebuild {
    param([string]$Reason)

    if (-not (Test-Path -LiteralPath $script:DbFile)) {
        return
    }

    if (-not $script:ForceRebuild -and [Environment]::UserInteractive) {
        Write-Host ""
        Write-Host "  Reason: $Reason"
        $confirm = Read-Host "  Delete $script:DbFile and rebuild? [y/N]"
        if ($confirm -notmatch '^[Yy]$') {
            Write-Host "  Aborted."
            exit 6
        }
    }

    Ensure-FileReleased -Path $script:DbFile -Purpose "rebuild the DuckDB catalog"
    Ensure-FileReleased -Path "$script:DbFile.wal" -Purpose "rebuild the DuckDB catalog"
    Remove-Item -LiteralPath $script:DbFile -Force
    Remove-Item -LiteralPath "$script:DbFile.wal" -Force -ErrorAction SilentlyContinue
    Write-Info "DB deleted: $script:DbFile"
}

function Test-FileLocked {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return $false
    }

    try {
        $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        $stream.Dispose()
        return $false
    } catch {
        return $true
    }
}

function Get-LikelyLockingProcesses {
    $processes = @()

    try {
        $pids = @(Get-NetTCPConnection -LocalPort 3003 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
        foreach ($pid in $pids) {
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($proc) {
                $processes += $proc
            }
        }
    } catch {
        # Get-NetTCPConnection is not available in all hosts.
    }

    try {
        $projectPattern = [regex]::Escape($script:ProjectRoot)
        $candidates = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -match '^(node|node\.exe|duckdb|duckdb\.exe)$' -and
                ($_.CommandLine -match $projectPattern -or $_.CommandLine -match 'fm_catalog\.duckdb')
            }
        foreach ($candidate in $candidates) {
            $proc = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
            if ($proc) {
                $processes += $proc
            }
        }
    } catch {
        # CIM process command-line inspection is best-effort.
    }

    return @($processes | Sort-Object Id -Unique)
}

function Ensure-FileReleased {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string]$Purpose = "continue"
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    while (Test-FileLocked -Path $Path) {
        Write-Host ""
        Write-WarnLine "The database file is currently locked: $Path"
        Write-WarnLine "It must be closed or released to $Purpose."

        $processes = @(Get-LikelyLockingProcesses)
        if ($processes.Count -gt 0) {
            Write-Host "Likely locking processes:"
            foreach ($proc in $processes) {
                Write-Host ("  PID {0}: {1}" -f $proc.Id, $proc.ProcessName)
            }

            $stop = Read-Host "Stop these processes now? [y/N]"
            if ($stop -match '^(y|yes)$') {
                foreach ($proc in $processes) {
                    try {
                        Stop-Process -Id $proc.Id -Force -ErrorAction Stop
                        Write-Info "Stopped process PID $($proc.Id) ($($proc.ProcessName))"
                    } catch {
                        Write-WarnLine "Could not stop PID $($proc.Id): $($_.Exception.Message)"
                    }
                }
                Start-Sleep -Seconds 1
                continue
            }
        } else {
            Write-Host "No obvious locking process was detected automatically."
        }

        $retry = Read-Host "Close the program that uses this DB, then press Enter to retry. Type Q to abort"
        if ($retry -match '^(q|quit|abort)$') {
            throw "Database file is locked and the operation was aborted: $Path"
        }
    }
}

function Get-XmlEncodingName {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $buffer = New-Object byte[] 8
        $read = $stream.Read($buffer, 0, $buffer.Length)

        if ($read -ge 2 -and $buffer[0] -eq 0xFF -and $buffer[1] -eq 0xFE) { return "utf-16le" }
        if ($read -ge 2 -and $buffer[0] -eq 0xFE -and $buffer[1] -eq 0xFF) { return "utf-16be" }
        if ($read -ge 3 -and $buffer[0] -eq 0xEF -and $buffer[1] -eq 0xBB -and $buffer[2] -eq 0xBF) { return "utf-8-bom" }

        if ($read -ge 4 -and $buffer[1] -eq 0x00 -and $buffer[3] -eq 0x00) { return "utf-16le" }
        if ($read -ge 4 -and $buffer[0] -eq 0x00 -and $buffer[2] -eq 0x00) { return "utf-16be" }

        return "utf-8-compatible"
    } finally {
        $stream.Dispose()
    }
}

function Write-ImportProgress {
    param(
        [Parameter(Mandatory = $true)][string]$Activity,
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][Int64]$BytesRead,
        [Parameter(Mandatory = $true)][Int64]$TotalBytes,
        [Parameter(Mandatory = $true)][TimeSpan]$Elapsed,
        [int]$Id = 1,
        [switch]$Completed
    )

    if ($Completed) {
        Write-Progress -Id $Id -Activity $Activity -Completed
        return
    }

    if ($TotalBytes -gt 0) {
        $safeRead = [Math]::Min($BytesRead, $TotalBytes)
        $percent = [Math]::Min(100, [Math]::Max(0, [int](($safeRead * 100.0) / $TotalBytes)))
        $status = "{0}: {1} / {2}, elapsed {3}" -f $Label, (Format-ByteSize -Bytes $safeRead), (Format-ByteSize -Bytes $TotalBytes), (Format-Duration -Duration $Elapsed)
        Write-Progress -Id $Id -Activity $Activity -Status $status -PercentComplete $percent
    } else {
        $status = "{0}: {1}, elapsed {2}" -f $Label, (Format-ByteSize -Bytes $BytesRead), (Format-Duration -Duration $Elapsed)
        Write-Progress -Id $Id -Activity $Activity -Status $status
    }
}

function Copy-FileWithProgress {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$TargetPath,
        [string]$Label = "Copying XML",
        [int]$ProgressId = 10
    )

    $totalBytes = (Get-Item -LiteralPath $SourcePath).Length
    $buffer = New-Object byte[] (4 * 1024 * 1024)
    $readTotal = [Int64]0
    $watch = [System.Diagnostics.Stopwatch]::StartNew()

    $input = [System.IO.File]::OpenRead($SourcePath)
    try {
        $output = [System.IO.File]::Create($TargetPath)
        try {
            while (($read = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $output.Write($buffer, 0, $read)
                $readTotal += $read
                Write-ImportProgress -Activity "FileMaker XML import" -Label $Label -BytesRead $readTotal -TotalBytes $totalBytes -Elapsed $watch.Elapsed -Id $ProgressId
            }
        } finally {
            $output.Dispose()
        }
    } finally {
        $input.Dispose()
        $watch.Stop()
        Write-ImportProgress -Activity "FileMaker XML import" -Label $Label -BytesRead $readTotal -TotalBytes $totalBytes -Elapsed $watch.Elapsed -Id $ProgressId -Completed
    }
}

function Convert-ToUtf8File {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$TargetPath,
        [Parameter(Mandatory = $true)][string]$EncodingName
    )

    $sourceEncoding = switch ($EncodingName) {
        "utf-16le" { [System.Text.Encoding]::Unicode }
        "utf-16be" { [System.Text.Encoding]::BigEndianUnicode }
        default { $null }
    }

    if (-not $sourceEncoding) {
        Copy-FileWithProgress -SourcePath $SourcePath -TargetPath $TargetPath -Label "Copying XML to temp" -ProgressId 11
        return
    }

    $totalBytes = (Get-Item -LiteralPath $SourcePath).Length
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
    $reader = New-Object System.IO.StreamReader($SourcePath, $sourceEncoding, $true)
    $writer = New-Object System.IO.StreamWriter($TargetPath, $false, $utf8NoBom)
    try {
        $buffer = New-Object char[] 65536
        while (($read = $reader.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $writer.Write($buffer, 0, $read)
            $bytesRead = [Math]::Min([Int64]$reader.BaseStream.Position, [Int64]$totalBytes)
            Write-ImportProgress -Activity "FileMaker XML import" -Label "Converting XML to UTF-8" -BytesRead $bytesRead -TotalBytes $totalBytes -Elapsed $watch.Elapsed -Id 12
        }
    } finally {
        $writer.Dispose()
        $reader.Dispose()
        $watch.Stop()
        Write-ImportProgress -Activity "FileMaker XML import" -Label "Converting XML to UTF-8" -BytesRead $totalBytes -TotalBytes $totalBytes -Elapsed $watch.Elapsed -Id 12 -Completed
    }
}

function Get-XmlRootElement {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $buffer = New-Object byte[] 4096
        $read = $stream.Read($buffer, 0, $buffer.Length)
        if ($read -le 0) {
            return ""
        }

        $prefix = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $read)
        $match = [regex]::Match($prefix, '<(FMSaveAsXML|FMDynamicTemplate)(?:\s|>)')
        if ($match.Success) {
            return $match.Groups[1].Value
        }

        return ""
    } finally {
        $stream.Dispose()
    }
}

function Add-FmLabCSharpType {
    param([Parameter(Mandatory = $true)][string]$TypeDefinition)

    if ($PSVersionTable.PSEdition -eq "Core") {
        Add-Type -TypeDefinition $TypeDefinition
        return
    }

    Add-Type -ReferencedAssemblies @("System.Core", "System.Xml", "System.Xml.Linq") -TypeDefinition $TypeDefinition
}

function Ensure-XmlPreprocessor {
    if ("FmLabXmlPreprocessor" -as [type]) {
        return
    }

    Add-FmLabCSharpType -TypeDefinition @'
using System;
using System.IO;

public static class FmLabXmlPreprocessor
{
    public static long[] Preprocess(string inputPath, string outputPath)
    {
        return Preprocess(inputPath, outputPath, null);
    }

    public static long[] Preprocess(string inputPath, string outputPath, Action<long, long> progress)
    {
        long inputSize = new FileInfo(inputPath).Length;
        long outputSize = 0;
        long crCount = 0;
        long strippedCount = 0;

        byte[] inputBuffer = new byte[4 * 1024 * 1024];
        byte[] outputBuffer = new byte[inputBuffer.Length];

        using (FileStream input = File.OpenRead(inputPath))
        using (FileStream output = File.Create(outputPath))
        {
            int read;
            while ((read = input.Read(inputBuffer, 0, inputBuffer.Length)) > 0)
            {
                int outLength = 0;

                for (int i = 0; i < read; i++)
                {
                    byte value = inputBuffer[i];

                    if (value == 0x0D)
                    {
                        outputBuffer[outLength++] = 0x7F;
                        crCount++;
                    }
                    else if (
                        value <= 0x08 ||
                        value == 0x0B ||
                        value == 0x0C ||
                        (value >= 0x0E && value <= 0x1F)
                    )
                    {
                        strippedCount++;
                    }
                    else
                    {
                        outputBuffer[outLength++] = value;
                    }
                }

                if (outLength > 0)
                {
                    output.Write(outputBuffer, 0, outLength);
                    outputSize += outLength;
                }

                if (progress != null)
                {
                    progress(input.Position, inputSize);
                }
            }
        }

        return new long[] { inputSize, outputSize, crCount, strippedCount };
    }
}
'@
}

function Invoke-XmlPreprocess {
    param(
        [Parameter(Mandatory = $true)][string]$InputPath,
        [Parameter(Mandatory = $true)][string]$OutputPath
    )

    Ensure-XmlPreprocessor
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    [Action[Int64, Int64]]$progress = {
        param([Int64]$BytesRead, [Int64]$TotalBytes)
        Write-ImportProgress -Activity "FileMaker XML import" -Label "Cleaning XML for DuckDB" -BytesRead $BytesRead -TotalBytes $TotalBytes -Elapsed $watch.Elapsed -Id 13
    }

    try {
        $result = [FmLabXmlPreprocessor]::Preprocess($InputPath, $OutputPath, $progress)
    } finally {
        $watch.Stop()
        Write-ImportProgress -Activity "FileMaker XML import" -Label "Cleaning XML for DuckDB" -BytesRead (Get-Item -LiteralPath $InputPath).Length -TotalBytes (Get-Item -LiteralPath $InputPath).Length -Elapsed $watch.Elapsed -Id 13 -Completed
    }

    return [pscustomobject]@{
        InputSize = $result[0]
        OutputSize = $result[1]
        ReplacedCr = $result[2]
        StrippedInvalid = $result[3]
    }
}

function Ensure-XmlSegmenter {
    if ("FmLabXmlSegmenter" -as [type]) {
        return
    }

    Add-FmLabCSharpType -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Xml;

public static class FmLabXmlSegmenter
{
    private static string SanitizePart(string value)
    {
        StringBuilder builder = new StringBuilder();
        foreach (char c in value)
        {
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_')
            {
                builder.Append(c);
            }
            else
            {
                builder.Append('_');
            }
        }
        return builder.ToString();
    }

    private static XmlWriter CreateSegmentWriter(
        string filePath,
        XmlWriterSettings writerSettings,
        List<Tuple<string, string>> rootAttributes,
        string firstParent,
        string secondParent,
        string catalogName,
        out FileStream stream
    )
    {
        stream = File.Create(filePath);
        XmlWriter writer = XmlWriter.Create(stream, writerSettings);

        writer.WriteStartDocument();
        writer.WriteStartElement("FMSaveAsXML");
        foreach (Tuple<string, string> attribute in rootAttributes)
        {
            writer.WriteAttributeString(attribute.Item1, attribute.Item2);
        }

        writer.WriteStartElement(firstParent);
        writer.WriteStartElement(secondParent);
        writer.WriteStartElement(catalogName);

        return writer;
    }

    private static void WriteAttributes(XmlReader reader, XmlWriter writer)
    {
        if (!reader.HasAttributes)
        {
            return;
        }

        while (reader.MoveToNextAttribute())
        {
            writer.WriteAttributeString(reader.Prefix, reader.LocalName, reader.NamespaceURI, reader.Value);
        }
        reader.MoveToElement();
    }

    private static void WriteCurrentElement(XmlReader reader, XmlWriter writer)
    {
        int startDepth = reader.Depth;

        while (true)
        {
            switch (reader.NodeType)
            {
                case XmlNodeType.Element:
                    writer.WriteStartElement(reader.Prefix, reader.LocalName, reader.NamespaceURI);
                    WriteAttributes(reader, writer);
                    if (reader.IsEmptyElement)
                    {
                        writer.WriteEndElement();
                    }
                    break;

                case XmlNodeType.EndElement:
                    writer.WriteEndElement();
                    if (reader.Depth == startDepth)
                    {
                        return;
                    }
                    break;

                case XmlNodeType.Text:
                    writer.WriteString(reader.Value);
                    break;

                case XmlNodeType.CDATA:
                    writer.WriteCData(reader.Value);
                    break;

                case XmlNodeType.Whitespace:
                case XmlNodeType.SignificantWhitespace:
                    writer.WriteWhitespace(reader.Value);
                    break;

                case XmlNodeType.Comment:
                    writer.WriteComment(reader.Value);
                    break;

                case XmlNodeType.ProcessingInstruction:
                    writer.WriteProcessingInstruction(reader.Name, reader.Value);
                    break;

                case XmlNodeType.EntityReference:
                    writer.WriteEntityRef(reader.Name);
                    break;
            }

            if (!reader.Read())
            {
                return;
            }
        }
    }

    private static void SkipCurrentElement(XmlReader reader)
    {
        int startDepth = reader.Depth;
        if (reader.IsEmptyElement)
        {
            return;
        }

        while (reader.Read())
        {
            if (reader.NodeType == XmlNodeType.EndElement && reader.Depth == startDepth)
            {
                return;
            }
        }
    }

    private static void CloseSegmentWriter(XmlWriter writer)
    {
        if (writer == null)
        {
            return;
        }

        writer.WriteEndElement();
        writer.WriteEndElement();
        writer.WriteEndElement();
        writer.WriteEndElement();
        writer.WriteEndDocument();
        writer.Dispose();
    }

    private static bool UsesItemLimit(string catalogName)
    {
        return String.Equals(catalogName, "LayoutCatalog", StringComparison.OrdinalIgnoreCase);
    }

    private static bool ShouldSkipCatalog(string catalogName, string skipCatalogNames)
    {
        if (String.IsNullOrEmpty(skipCatalogNames))
        {
            return false;
        }

        string[] names = skipCatalogNames.Split('|');
        foreach (string name in names)
        {
            if (String.Equals(catalogName, name, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static List<string> SplitOversizedCatalog(
        string inputSegmentPath,
        string outputDirectory,
        int catalogIndex,
        string firstParent,
        string secondParent,
        string catalogName,
        List<Tuple<string, string>> rootAttributes,
        XmlReaderSettings readerSettings,
        XmlWriterSettings writerSettings,
        long maxSegmentBytes,
        int maxSegmentItems
    )
    {
        List<string> splitFiles = new List<string>();
        int partIndex = 0;
        int childCount = 0;
        XmlWriter writer = null;
        FileStream stream = null;

        try
        {
            using (XmlReader reader = XmlReader.Create(inputSegmentPath, readerSettings))
            {
                while (reader.Read())
                {
                    if (reader.NodeType != XmlNodeType.Element || reader.Depth != 4)
                    {
                        continue;
                    }

                    if (writer == null)
                    {
                        string fileName = String.Format(
                            "{0:000}_{1}_{2}_{3}_part{4:000}.xml",
                            catalogIndex,
                            SanitizePart(firstParent),
                            SanitizePart(secondParent),
                            SanitizePart(catalogName),
                            ++partIndex
                        );
                        string filePath = Path.Combine(outputDirectory, fileName);
                        writer = CreateSegmentWriter(
                            filePath,
                            writerSettings,
                            rootAttributes,
                            firstParent,
                            secondParent,
                            catalogName,
                            out stream
                        );
                        splitFiles.Add(fileName);
                        childCount = 0;
                    }

                    WriteCurrentElement(reader, writer);
                    childCount++;

                    writer.Flush();
                    bool reachedByteLimit = stream != null && stream.Position >= maxSegmentBytes;
                    bool reachedItemLimit = UsesItemLimit(catalogName) && maxSegmentItems > 0 && childCount >= maxSegmentItems;
                    if ((reachedByteLimit || reachedItemLimit) && childCount > 0)
                    {
                        CloseSegmentWriter(writer);
                        writer = null;
                        stream.Dispose();
                        stream = null;
                    }
                }
            }
        }
        finally
        {
            if (writer != null)
            {
                CloseSegmentWriter(writer);
            }

            if (stream != null)
            {
                stream.Dispose();
            }
        }

        return splitFiles;
    }

    public static string[] SplitCatalogs(string inputPath, string outputDirectory, long maxSegmentBytes, int maxSegmentItems, string skipCatalogNames)
    {
        Directory.CreateDirectory(outputDirectory);

        XmlReaderSettings readerSettings = new XmlReaderSettings();
        readerSettings.DtdProcessing = DtdProcessing.Ignore;
        readerSettings.IgnoreWhitespace = false;
        readerSettings.CloseInput = true;

        XmlWriterSettings writerSettings = new XmlWriterSettings();
        writerSettings.Encoding = new UTF8Encoding(false);
        writerSettings.Indent = false;
        writerSettings.CloseOutput = true;

        List<Tuple<string, string>> rootAttributes = new List<Tuple<string, string>>();
        string[] path = new string[16];
        List<string> segmentFiles = new List<string>();
        int index = 0;

        using (XmlReader reader = XmlReader.Create(inputPath, readerSettings))
        {
            while (reader.Read())
            {
                if (reader.NodeType != XmlNodeType.Element)
                {
                    continue;
                }

                if (reader.Depth >= path.Length)
                {
                    Array.Resize(ref path, reader.Depth + 16);
                }

                path[reader.Depth] = reader.Name;

                if (reader.Depth == 0 && rootAttributes.Count == 0 && reader.HasAttributes)
                {
                    while (reader.MoveToNextAttribute())
                    {
                        rootAttributes.Add(Tuple.Create(reader.Name, reader.Value));
                    }
                    reader.MoveToElement();
                    continue;
                }

                if (reader.Depth != 3)
                {
                    continue;
                }

                string firstParent = path[1] ?? "Root";
                string secondParent = path[2] ?? "Action";
                string catalogName = reader.Name;

                if (ShouldSkipCatalog(catalogName, skipCatalogNames))
                {
                    SkipCurrentElement(reader);
                    continue;
                }

                string fileName = String.Format(
                    "{0:000}_{1}_{2}_{3}.xml",
                    ++index,
                    SanitizePart(firstParent),
                    SanitizePart(secondParent),
                    SanitizePart(catalogName)
                );
                string filePath = Path.Combine(outputDirectory, fileName);

                using (XmlWriter writer = XmlWriter.Create(filePath, writerSettings))
                {
                    writer.WriteStartDocument();
                    writer.WriteStartElement("FMSaveAsXML");
                    foreach (Tuple<string, string> attribute in rootAttributes)
                    {
                        writer.WriteAttributeString(attribute.Item1, attribute.Item2);
                    }

                    writer.WriteStartElement(firstParent);
                    writer.WriteStartElement(secondParent);
                    WriteCurrentElement(reader, writer);
                    writer.WriteEndElement();
                    writer.WriteEndElement();
                    writer.WriteEndElement();
                    writer.WriteEndDocument();
                }

                if (maxSegmentBytes > 0 && new FileInfo(filePath).Length > maxSegmentBytes)
                {
                    List<string> splitFiles = SplitOversizedCatalog(
                        filePath,
                        outputDirectory,
                        index,
                        firstParent,
                        secondParent,
                        catalogName,
                        rootAttributes,
                        readerSettings,
                        writerSettings,
                        maxSegmentBytes,
                        maxSegmentItems
                    );

                    if (splitFiles.Count > 0)
                    {
                        File.Delete(filePath);
                        segmentFiles.AddRange(splitFiles);
                    }
                    else
                    {
                        segmentFiles.Add(fileName);
                    }
                }
                else
                {
                    segmentFiles.Add(fileName);
                }
            }
        }

        return segmentFiles.ToArray();
    }
}
'@
}

function Split-XmlIntoCatalogSegments {
    param(
        [Parameter(Mandatory = $true)][string]$InputPath,
        [Parameter(Mandatory = $true)][string]$OutputDirectory,
        [string[]]$SkipCatalogNames = @()
    )

    Ensure-XmlSegmenter
    return [FmLabXmlSegmenter]::SplitCatalogs($InputPath, $OutputDirectory, $script:LargeSegmentTargetBytes, $script:LargeSegmentMaxItems, ($SkipCatalogNames -join "|"))
}

function Ensure-LayoutStreamExtractor {
    if ("FmLabLayoutStreamExtractor" -as [type]) {
        return
    }

    Add-FmLabCSharpType -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

public sealed class FmLabCsvWriter : IDisposable
{
    private readonly StreamWriter writer;

    public FmLabCsvWriter(string path, string[] header)
    {
        UTF8Encoding utf8NoBom = new UTF8Encoding(false);
        writer = new StreamWriter(path, false, utf8NoBom);
        WriteRow(header);
    }

    public void WriteRow(params string[] values)
    {
        for (int i = 0; i < values.Length; i++)
        {
            if (i > 0)
            {
                writer.Write(',');
            }
            writer.Write(Escape(values[i]));
        }
        writer.WriteLine();
    }

    private static string Escape(string value)
    {
        if (value == null)
        {
            return "";
        }

        bool mustQuote = value.IndexOf(',') >= 0 ||
                         value.IndexOf('"') >= 0 ||
                         value.IndexOf('\r') >= 0 ||
                         value.IndexOf('\n') >= 0;
        if (!mustQuote)
        {
            return value;
        }

        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }

    public void Dispose()
    {
        writer.Dispose();
    }
}

public static class FmLabLayoutStreamExtractor
{
    private static readonly Regex DdrRefRegex = new Regex(
        "kind=\"ChunkList\" hash=\"([^\"]+)\"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>",
        RegexOptions.Compiled
    );

    private static bool IsElement(XElement element, string name)
    {
        return element != null && String.Equals(element.Name.LocalName, name, StringComparison.Ordinal);
    }

    private static IEnumerable<XElement> Children(XContainer container, string name)
    {
        if (container == null)
        {
            yield break;
        }

        foreach (XElement child in container.Elements())
        {
            if (String.Equals(child.Name.LocalName, name, StringComparison.Ordinal))
            {
                yield return child;
            }
        }
    }

    private static XElement Child(XContainer container, string name)
    {
        if (container == null)
        {
            return null;
        }

        foreach (XElement child in container.Elements())
        {
            if (String.Equals(child.Name.LocalName, name, StringComparison.Ordinal))
            {
                return child;
            }
        }

        return null;
    }

    private static XElement ChildPath(XContainer container, params string[] names)
    {
        XContainer current = container;
        XElement element = null;
        foreach (string name in names)
        {
            element = Child(current, name);
            if (element == null)
            {
                return null;
            }
            current = element;
        }
        return element;
    }

    private static string Attr(XElement element, string name)
    {
        if (element == null)
        {
            return null;
        }

        foreach (XAttribute attr in element.Attributes())
        {
            if (String.Equals(attr.Name.LocalName, name, StringComparison.Ordinal))
            {
                return attr.Value;
            }
        }

        return null;
    }

    private static string TextAt(XContainer container, params string[] names)
    {
        XElement element = ChildPath(container, names);
        return element == null ? null : element.Value;
    }

    private static string AttrAt(XContainer container, string[] names, string attrName)
    {
        return Attr(ChildPath(container, names), attrName);
    }

    private static string NormalizeText(string value)
    {
        return value == null ? null : value.Replace('\u007f', '\n');
    }

    private static string NormalizeBool(string value)
    {
        if (String.IsNullOrEmpty(value))
        {
            return null;
        }

        return value.Equals("true", StringComparison.OrdinalIgnoreCase) ||
               value.Equals("yes", StringComparison.OrdinalIgnoreCase) ||
               value.Equals("1", StringComparison.OrdinalIgnoreCase) ||
               value.Equals("True", StringComparison.Ordinal) ? "true" : "false";
    }

    private static string NormalizeFileName(string rawFileName)
    {
        if (String.IsNullOrWhiteSpace(rawFileName))
        {
            return "";
        }

        string name = rawFileName.Trim();
        if (name.EndsWith(".fmp12", StringComparison.OrdinalIgnoreCase))
        {
            name = name.Substring(0, name.Length - ".fmp12".Length);
        }

        return name;
    }

    private static IEnumerable<XElement> DirectNestedLayoutObjects(XElement parentObject)
    {
        foreach (XElement objectList in parentObject.Descendants().Where(e => IsElement(e, "ObjectList")))
        {
            int layoutObjectAncestorCount = objectList.Ancestors().Count(e => IsElement(e, "LayoutObject"));
            if (layoutObjectAncestorCount != 1)
            {
                continue;
            }

            foreach (XElement childObject in Children(objectList, "LayoutObject"))
            {
                yield return childObject;
            }
        }
    }

    private static string JoinScriptTriggerParameters(XElement layoutObject)
    {
        List<string> values = new List<string>();
        XElement triggers = Child(layoutObject, "ScriptTriggers");
        foreach (XElement trigger in Children(triggers, "ScriptTrigger"))
        {
            string text = TextAt(trigger, "ScriptReference", "Calculation", "Text");
            if (!String.IsNullOrEmpty(text))
            {
                values.Add(NormalizeText(text));
            }
        }

        return values.Count == 0 ? null : String.Join("\n", values.ToArray());
    }

    private static void WriteLayoutReferences(
        FmLabCsvWriter references,
        XElement layoutObject,
        string objectUuid,
        string fileName,
        ref long referenceCount
    )
    {
        if (String.IsNullOrEmpty(objectUuid))
        {
            return;
        }

        XElement fieldRef = ChildPath(layoutObject, "Field", "FieldReference");
        string fieldUuid = Attr(fieldRef, "UUID");
        if (!String.IsNullOrEmpty(fieldUuid))
        {
            references.WriteRow(objectUuid, "field", fieldUuid, Attr(fieldRef, "name"), fileName);
            referenceCount++;
        }

        XElement valueListRef = ChildPath(layoutObject, "Field", "Display", "ValueListReference");
        string valueListUuid = Attr(valueListRef, "UUID");
        if (!String.IsNullOrEmpty(valueListUuid))
        {
            references.WriteRow(objectUuid, "valuelist", valueListUuid, Attr(valueListRef, "name"), fileName);
            referenceCount++;
        }

        if (String.Equals(Attr(layoutObject, "type"), "Portal", StringComparison.Ordinal))
        {
            XElement tableOccurrenceRef = ChildPath(layoutObject, "Portal", "TableOccurrenceReference");
            string tableOccurrenceUuid = Attr(tableOccurrenceRef, "UUID");
            if (!String.IsNullOrEmpty(tableOccurrenceUuid))
            {
                references.WriteRow(objectUuid, "table_occurrence", tableOccurrenceUuid, Attr(tableOccurrenceRef, "name"), fileName);
                referenceCount++;
            }
        }

        foreach (XElement scriptRef in layoutObject.Descendants().Where(e => IsElement(e, "ScriptReference")))
        {
            string scriptUuid = Attr(scriptRef, "UUID");
            if (!String.IsNullOrEmpty(scriptUuid))
            {
                references.WriteRow(objectUuid, "script", scriptUuid, Attr(scriptRef, "name"), fileName);
                referenceCount++;
            }
        }
    }

    private static void WriteCalcHashes(
        FmLabCsvWriter calcHashes,
        string objectXml,
        string objectUuid,
        string fileName,
        ref long calcHashCount
    )
    {
        if (String.IsNullOrEmpty(objectUuid) || String.IsNullOrEmpty(objectXml) || objectXml.IndexOf("DDRREF", StringComparison.Ordinal) < 0)
        {
            return;
        }

        foreach (Match match in DdrRefRegex.Matches(objectXml))
        {
            calcHashes.WriteRow(objectUuid, match.Groups[1].Value, match.Groups[2].Value, fileName);
            calcHashCount++;
        }
    }

    private static void ProcessLayoutObject(
        XElement layoutObject,
        string layoutId,
        string partType,
        string parentObjectId,
        int nestingLevel,
        int zOrder,
        string fileName,
        FmLabCsvWriter objects,
        FmLabCsvWriter references,
        FmLabCsvWriter calcHashes,
        ref long objectCount,
        ref long referenceCount,
        ref long calcHashCount
    )
    {
        string objectXml = layoutObject.ToString(SaveOptions.DisableFormatting);
        string objectUuid = TextAt(layoutObject, "UUID");

        objects.WriteRow(
            layoutId,
            partType,
            Attr(layoutObject, "id"),
            Attr(layoutObject, "type"),
            Attr(layoutObject, "name"),
            Attr(layoutObject, "kind"),
            Attr(layoutObject, "hash"),
            objectUuid,
            AttrAt(layoutObject, new string[] { "Bounds" }, "top"),
            AttrAt(layoutObject, new string[] { "Bounds" }, "left"),
            AttrAt(layoutObject, new string[] { "Bounds" }, "bottom"),
            AttrAt(layoutObject, new string[] { "Bounds" }, "right"),
            parentObjectId,
            nestingLevel.ToString(System.Globalization.CultureInfo.InvariantCulture),
            zOrder.ToString(System.Globalization.CultureInfo.InvariantCulture),
            NormalizeText(TextAt(layoutObject, "Conditions", "Hide", "Calculation", "Text")),
            NormalizeText(TextAt(layoutObject, "Tooltip", "Calculation", "Text")),
            NormalizeText(TextAt(layoutObject, "Button", "Label", "Calculation", "Text")) ??
                NormalizeText(TextAt(layoutObject, "GroupedButton", "Label", "Calculation", "Text")) ??
                NormalizeText(TextAt(layoutObject, "PopoverButton", "Label", "Calculation", "Text")),
            JoinScriptTriggerParameters(layoutObject),
            NormalizeText(TextAt(layoutObject, "Text", "StyledText", "Data")),
            objectXml,
            fileName
        );
        objectCount++;

        WriteLayoutReferences(references, layoutObject, objectUuid, fileName, ref referenceCount);
        WriteCalcHashes(calcHashes, objectXml, objectUuid, fileName, ref calcHashCount);

        int childZOrder = 0;
        foreach (XElement childObject in DirectNestedLayoutObjects(layoutObject))
        {
            ProcessLayoutObject(
                childObject,
                layoutId,
                partType,
                Attr(layoutObject, "id"),
                nestingLevel + 1,
                ++childZOrder,
                fileName,
                objects,
                references,
                calcHashes,
                ref objectCount,
                ref referenceCount,
                ref calcHashCount
            );
        }
    }

    private static void ProcessLayout(
        XElement layout,
        long sequenceId,
        string fileName,
        FmLabCsvWriter layouts,
        FmLabCsvWriter parts,
        FmLabCsvWriter objects,
        FmLabCsvWriter references,
        FmLabCsvWriter calcHashes,
        ref long partCount,
        ref long objectCount,
        ref long referenceCount,
        ref long calcHashCount
    )
    {
        string layoutId = Attr(layout, "id");
        string layoutName = Attr(layout, "name");

        layouts.WriteRow(
            layoutId,
            layoutName,
            TextAt(layout, "UUID"),
            AttrAt(layout, new string[] { "TableOccurrenceReference" }, "name"),
            Attr(layout, "isFolder"),
            NormalizeBool(Attr(layout, "isSeparatorItem")),
            sequenceId.ToString(System.Globalization.CultureInfo.InvariantCulture),
            fileName
        );

        XElement partsList = Child(layout, "PartsList");
        foreach (XElement part in Children(partsList, "Part"))
        {
            XElement objectList = Child(part, "ObjectList");
            int rootObjectCount = objectList == null ? 0 : Children(objectList, "LayoutObject").Count();
            parts.WriteRow(
                layoutId,
                layoutName,
                Attr(part, "type"),
                Attr(part, "kind"),
                AttrAt(part, new string[] { "Definition" }, "type"),
                AttrAt(part, new string[] { "Definition" }, "kind"),
                AttrAt(part, new string[] { "Definition" }, "size"),
                AttrAt(part, new string[] { "Definition" }, "absolute"),
                AttrAt(part, new string[] { "Definition" }, "Options"),
                rootObjectCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
                fileName
            );
            partCount++;

            int zOrder = 0;
            foreach (XElement rootObject in Children(objectList, "LayoutObject"))
            {
                ProcessLayoutObject(
                    rootObject,
                    layoutId,
                    Attr(part, "type"),
                    null,
                    0,
                    ++zOrder,
                    fileName,
                    objects,
                    references,
                    calcHashes,
                    ref objectCount,
                    ref referenceCount,
                    ref calcHashCount
                );
            }
        }
    }

    public static string[] Extract(string inputPath, string outputDirectory)
    {
        Directory.CreateDirectory(outputDirectory);

        string layoutsPath = Path.Combine(outputDirectory, "layouts.csv");
        string partsPath = Path.Combine(outputDirectory, "layout_parts.csv");
        string objectsPath = Path.Combine(outputDirectory, "layout_objects.csv");
        string referencesPath = Path.Combine(outputDirectory, "layout_references.csv");
        string calcHashesPath = Path.Combine(outputDirectory, "layout_object_calc_hashes.csv");

        XmlReaderSettings settings = new XmlReaderSettings();
        settings.DtdProcessing = DtdProcessing.Ignore;
        settings.IgnoreWhitespace = false;
        settings.CloseInput = true;

        string[] path = new string[16];
        string fileName = "";
        long layoutCount = 0;
        long partCount = 0;
        long objectCount = 0;
        long referenceCount = 0;
        long calcHashCount = 0;

        using (FmLabCsvWriter layouts = new FmLabCsvWriter(layoutsPath, new string[] { "L_ID", "L_Name", "L_UUID", "L_TO_Name", "Folder_Type", "Is_Separator", "Sequence_ID", "File_Name" }))
        using (FmLabCsvWriter parts = new FmLabCsvWriter(partsPath, new string[] { "Layout_ID", "Layout_Name", "Part_Type", "Part_Kind", "Definition_Type", "Definition_Kind", "Part_Size", "Part_Absolute", "Part_Options", "Object_Count", "File_Name" }))
        using (FmLabCsvWriter objects = new FmLabCsvWriter(objectsPath, new string[] { "Layout_ID", "Part_Type", "Object_ID", "Object_Type", "Object_Name", "Object_Kind", "Object_Hash", "Object_UUID", "Bounds_Top", "Bounds_Left", "Bounds_Bottom", "Bounds_Right", "Parent_Object_ID", "Nesting_Level", "Z_Order", "Hide_Calculation_Text", "Tooltip_Calculation_Text", "Label_Calculation_Text", "ScriptTrigger_Parameter_Text", "Text_Content", "Object_XML", "File_Name" }))
        using (FmLabCsvWriter references = new FmLabCsvWriter(referencesPath, new string[] { "Object_UUID", "Ref_Type", "Ref_UUID", "Ref_Name", "File_Name" }))
        using (FmLabCsvWriter calcHashes = new FmLabCsvWriter(calcHashesPath, new string[] { "Object_UUID", "Calc_Hash", "Subrole", "File_Name" }))
        using (XmlReader reader = XmlReader.Create(inputPath, settings))
        {
            while (reader.Read())
            {
                if (reader.NodeType != XmlNodeType.Element)
                {
                    continue;
                }

                if (reader.Depth >= path.Length)
                {
                    Array.Resize(ref path, reader.Depth + 16);
                }
                path[reader.Depth] = reader.Name;

                if (reader.Depth == 0 && String.Equals(reader.Name, "FMSaveAsXML", StringComparison.Ordinal))
                {
                    fileName = NormalizeFileName(reader.GetAttribute("File"));
                    continue;
                }

                if (
                    reader.Depth == 4 &&
                    String.Equals(reader.Name, "Layout", StringComparison.Ordinal) &&
                    String.Equals(path[3], "LayoutCatalog", StringComparison.Ordinal)
                )
                {
                    XElement layout = (XElement)XNode.ReadFrom(reader);
                    if (String.IsNullOrEmpty(Attr(layout, "id")) &&
                        String.IsNullOrEmpty(Attr(layout, "name")) &&
                        String.IsNullOrEmpty(TextAt(layout, "UUID")))
                    {
                        continue;
                    }

                    ProcessLayout(
                        layout,
                        ++layoutCount,
                        fileName,
                        layouts,
                        parts,
                        objects,
                        references,
                        calcHashes,
                        ref partCount,
                        ref objectCount,
                        ref referenceCount,
                        ref calcHashCount
                    );
                }
            }
        }

        return new string[] {
            fileName,
            layoutCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
            partCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
            objectCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
            referenceCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
            calcHashCount.ToString(System.Globalization.CultureInfo.InvariantCulture)
        };
    }
}
'@
}

function Invoke-LayoutStreamExtract {
    param(
        [Parameter(Mandatory = $true)][string]$InputPath,
        [Parameter(Mandatory = $true)][string]$OutputDirectory
    )

    Ensure-LayoutStreamExtractor
    $result = [FmLabLayoutStreamExtractor]::Extract($InputPath, $OutputDirectory)

    return [pscustomobject]@{
        Enabled = $true
        Directory = $OutputDirectory
        FileName = $result[0]
        LayoutCount = [int64]$result[1]
        PartCount = [int64]$result[2]
        ObjectCount = [int64]$result[3]
        ReferenceCount = [int64]$result[4]
        CalcHashCount = [int64]$result[5]
    }
}

function Ensure-StepStreamExtractor {
    Ensure-LayoutStreamExtractor

    if ("FmLabStepStreamExtractor" -as [type]) {
        return
    }

    Add-FmLabCSharpType -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

public sealed class FmLabStepCsvWriter : IDisposable
{
    private readonly StreamWriter writer;

    public FmLabStepCsvWriter(string path, string[] header)
    {
        System.Text.UTF8Encoding utf8NoBom = new System.Text.UTF8Encoding(false);
        writer = new StreamWriter(path, false, utf8NoBom);
        WriteRow(header);
    }

    public void WriteRow(params string[] values)
    {
        for (int i = 0; i < values.Length; i++)
        {
            if (i > 0)
            {
                writer.Write(',');
            }
            writer.Write(Escape(values[i]));
        }
        writer.WriteLine();
    }

    private static string Escape(string value)
    {
        if (value == null)
        {
            return "";
        }

        bool mustQuote = value.IndexOf(',') >= 0 ||
                         value.IndexOf('"') >= 0 ||
                         value.IndexOf('\r') >= 0 ||
                         value.IndexOf('\n') >= 0;
        if (!mustQuote)
        {
            return value;
        }

        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }

    public void Dispose()
    {
        writer.Dispose();
    }
}

public static class FmLabStepStreamExtractor
{
    private static readonly Regex DdrRefRegex = new Regex(
        "kind=\"ChunkList\" hash=\"([^\"]+)\"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>",
        RegexOptions.Compiled
    );

    private static bool IsElement(XElement element, string name)
    {
        return element != null && String.Equals(element.Name.LocalName, name, StringComparison.Ordinal);
    }

    private static IEnumerable<XElement> Children(XContainer container, string name)
    {
        if (container == null)
        {
            yield break;
        }

        foreach (XElement child in container.Elements())
        {
            if (String.Equals(child.Name.LocalName, name, StringComparison.Ordinal))
            {
                yield return child;
            }
        }
    }

    private static XElement Child(XContainer container, string name)
    {
        return Children(container, name).FirstOrDefault();
    }

    private static XElement Descendant(XContainer container, string name)
    {
        if (container == null)
        {
            return null;
        }

        return container.Descendants().FirstOrDefault(e => IsElement(e, name));
    }

    private static IEnumerable<XElement> Descendants(XContainer container, string name)
    {
        if (container == null)
        {
            yield break;
        }

        foreach (XElement element in container.Descendants())
        {
            if (IsElement(element, name))
            {
                yield return element;
            }
        }
    }

    private static string Attr(XElement element, string name)
    {
        if (element == null)
        {
            return null;
        }

        foreach (XAttribute attr in element.Attributes())
        {
            if (String.Equals(attr.Name.LocalName, name, StringComparison.Ordinal))
            {
                return attr.Value;
            }
        }

        return null;
    }

    private static string TextOfChild(XContainer container, string name)
    {
        XElement child = Child(container, name);
        return child == null ? null : child.Value;
    }

    private static string NormalizeText(string value)
    {
        return value == null ? null : value.Replace('\u007f', '\n');
    }

    private static string NormalizeBool(string value)
    {
        if (String.IsNullOrEmpty(value))
        {
            return null;
        }

        return value.Equals("true", StringComparison.OrdinalIgnoreCase) ||
               value.Equals("yes", StringComparison.OrdinalIgnoreCase) ||
               value.Equals("1", StringComparison.OrdinalIgnoreCase) ||
               value.Equals("True", StringComparison.Ordinal) ? "true" : "false";
    }

    private static string NormalizeFileName(string rawFileName)
    {
        if (String.IsNullOrWhiteSpace(rawFileName))
        {
            return "";
        }

        string name = rawFileName.Trim();
        if (name.EndsWith(".fmp12", StringComparison.OrdinalIgnoreCase))
        {
            name = name.Substring(0, name.Length - ".fmp12".Length);
        }

        return name;
    }

    private static string StripLeadingUnderscore(string value)
    {
        if (String.IsNullOrEmpty(value))
        {
            return value;
        }

        return value.StartsWith("_", StringComparison.Ordinal) ? value.Substring(1) : value;
    }

    private static string FirstParameterType(XElement step)
    {
        return Attr(Descendant(step, "Parameter"), "type");
    }

    private static string FirstVariableName(XElement step)
    {
        foreach (XElement parameter in Descendants(step, "Parameter"))
        {
            if (String.Equals(Attr(parameter, "type"), "Variable", StringComparison.Ordinal))
            {
                return Attr(Child(parameter, "Name"), "value");
            }
        }

        return null;
    }

    private static string FirstCalculationText(XElement step)
    {
        XElement calculation = Descendant(step, "Calculation");
        return NormalizeText(TextOfChild(calculation, "Text"));
    }

    private static XElement FirstDdrRef(XElement step, string kind)
    {
        foreach (XElement ddrRef in Children(step, "DDRREF"))
        {
            if (String.Equals(Attr(ddrRef, "kind"), kind, StringComparison.Ordinal))
            {
                return ddrRef;
            }
        }

        return null;
    }

    private static string VariableScope(string name)
    {
        if (String.IsNullOrEmpty(name))
        {
            return null;
        }

        if (name.StartsWith("$$$", StringComparison.Ordinal))
        {
            return "superglobal";
        }

        if (name.StartsWith("$$", StringComparison.Ordinal))
        {
            return "global";
        }

        return "local";
    }

    private static void WriteStepReferences(
        FmLabStepCsvWriter references,
        XElement step,
        string scriptUuid,
        string stepUuid,
        string stepName,
        string stepIndex,
        string fileName,
        ref long referenceCount
    )
    {
        if (String.IsNullOrEmpty(stepUuid))
        {
            return;
        }

        if (!String.IsNullOrEmpty(stepName) && stepName.IndexOf("Perform Script", StringComparison.Ordinal) >= 0)
        {
            XElement scriptRef = Descendant(step, "ScriptReference");
            string refUuid = Attr(scriptRef, "UUID");
            if (!String.IsNullOrEmpty(refUuid))
            {
                XElement dataSourceRef = Descendant(step, "DataSourceReference");
                references.WriteRow(scriptUuid, stepUuid, stepName, stepIndex, "script", refUuid, Attr(scriptRef, "name"), fileName, null, null, Attr(dataSourceRef, "name"), Attr(dataSourceRef, "UUID"), null, null);
                referenceCount++;
            }
        }

        foreach (XElement fieldRef in Descendants(step, "FieldReference"))
        {
            string refUuid = Attr(fieldRef, "UUID");
            if (!String.IsNullOrEmpty(refUuid))
            {
                XElement tableOccurrenceRef = Child(fieldRef, "TableOccurrenceReference");
                references.WriteRow(scriptUuid, stepUuid, stepName, stepIndex, "field", refUuid, Attr(fieldRef, "name"), fileName, Attr(tableOccurrenceRef, "name"), Attr(tableOccurrenceRef, "UUID"), null, null, null, null);
                referenceCount++;
            }
        }

        if (String.Equals(stepName, "Go to Related Record", StringComparison.Ordinal))
        {
            XElement tableOccurrenceRef = Descendant(step, "TableOccurrenceReference");
            string tableOccurrenceUuid = Attr(tableOccurrenceRef, "UUID");
            if (!String.IsNullOrEmpty(tableOccurrenceUuid))
            {
                references.WriteRow(scriptUuid, stepUuid, stepName, stepIndex, "tableOccurrence", tableOccurrenceUuid, Attr(tableOccurrenceRef, "name"), fileName, null, null, null, null, null, null);
                referenceCount++;
            }

            XElement layoutRef = Descendant(step, "LayoutReference");
            string layoutUuid = Attr(layoutRef, "UUID");
            if (!String.IsNullOrEmpty(layoutUuid))
            {
                references.WriteRow(scriptUuid, stepUuid, stepName, stepIndex, "layout", layoutUuid, Attr(layoutRef, "name"), fileName, null, null, null, null, null, null);
                referenceCount++;
            }
        }

        if (String.Equals(stepName, "Go to Layout", StringComparison.Ordinal))
        {
            XElement layoutRef = Descendant(step, "LayoutReference");
            string layoutUuid = Attr(layoutRef, "UUID");
            if (!String.IsNullOrEmpty(layoutUuid))
            {
                references.WriteRow(scriptUuid, stepUuid, stepName, stepIndex, "layout", layoutUuid, Attr(layoutRef, "name"), fileName, null, null, null, null, null, null);
                referenceCount++;
            }
        }

        if (String.Equals(stepName, "Set Variable", StringComparison.Ordinal))
        {
            XElement nameElement = Descendant(step, "Name");
            string variableName = Attr(nameElement, "value");
            if (!String.IsNullOrEmpty(variableName))
            {
                references.WriteRow(scriptUuid, stepUuid, stepName, stepIndex, "variable", null, variableName, fileName, null, null, null, null, VariableScope(variableName), "set");
                referenceCount++;
            }
        }
    }

    private static void WriteCalcHashes(
        FmLabStepCsvWriter calcHashes,
        string parametersXml,
        string scriptUuid,
        string stepIndex,
        string fileName,
        ref long calcHashCount
    )
    {
        if (String.IsNullOrEmpty(scriptUuid) || String.IsNullOrEmpty(parametersXml) || parametersXml.IndexOf("DDRREF", StringComparison.Ordinal) < 0)
        {
            return;
        }

        foreach (Match match in DdrRefRegex.Matches(parametersXml))
        {
            calcHashes.WriteRow(scriptUuid, stepIndex, match.Groups[1].Value, match.Groups[2].Value, fileName);
            calcHashCount++;
        }
    }

    private static void ProcessScript(
        XElement script,
        string fileName,
        FmLabStepCsvWriter steps,
        FmLabStepCsvWriter references,
        FmLabStepCsvWriter calcHashes,
        ref long stepCount,
        ref long referenceCount,
        ref long calcHashCount
    )
    {
        XElement scriptRef = Child(script, "ScriptReference");
        string scriptId = Attr(scriptRef, "id");
        string scriptName = Attr(scriptRef, "name");
        string scriptUuid = Attr(scriptRef, "UUID");
        XElement objectList = Child(script, "ObjectList");

        foreach (XElement step in Children(objectList, "Step"))
        {
            string stepUuid = TextOfChild(step, "UUID");
            string stepName = Attr(step, "name");
            string stepIndex = Attr(step, "index");
            XElement ddrRef = FirstDdrRef(step, "StepText");
            XElement parameterValues = Child(step, "ParameterValues");
            string parametersXml = parameterValues == null ? null : parameterValues.ToString(SaveOptions.DisableFormatting);
            XElement booleanElement = Descendant(step, "Boolean");

            steps.WriteRow(
                scriptId,
                scriptName,
                scriptUuid,
                stepIndex,
                Attr(step, "id"),
                stepName,
                NormalizeBool(Attr(step, "enable")),
                stepUuid,
                Attr(ddrRef, "hash"),
                StripLeadingUnderscore(ddrRef == null ? null : ddrRef.Value),
                parametersXml,
                FirstParameterType(step),
                FirstVariableName(step),
                FirstCalculationText(step),
                Attr(booleanElement, "type"),
                Attr(booleanElement, "value"),
                fileName
            );
            stepCount++;

            WriteStepReferences(references, step, scriptUuid, stepUuid, stepName, stepIndex, fileName, ref referenceCount);
            WriteCalcHashes(calcHashes, parametersXml, scriptUuid, stepIndex, fileName, ref calcHashCount);
        }
    }

    public static string[] Extract(string inputPath, string outputDirectory)
    {
        Directory.CreateDirectory(outputDirectory);

        string stepsPath = Path.Combine(outputDirectory, "steps_for_scripts.csv");
        string referencesPath = Path.Combine(outputDirectory, "step_references.csv");
        string calcHashesPath = Path.Combine(outputDirectory, "step_calc_hashes.csv");

        XmlReaderSettings settings = new XmlReaderSettings();
        settings.DtdProcessing = DtdProcessing.Ignore;
        settings.IgnoreWhitespace = false;
        settings.CloseInput = true;

        string[] path = new string[16];
        string fileName = "";
        long scriptCount = 0;
        long stepCount = 0;
        long referenceCount = 0;
        long calcHashCount = 0;

        using (FmLabStepCsvWriter steps = new FmLabStepCsvWriter(stepsPath, new string[] { "Script_ID", "Script_Name", "Script_UUID", "Step_Index", "Step_ID", "Step_Name", "Is_Enabled", "Step_UUID", "DDR_Hash", "DDR_UUID", "Parameters_XML", "Parameter_Type", "Variable_Name", "Calculation_Text", "Boolean_Type", "Boolean_Value", "File_Name" }))
        using (FmLabStepCsvWriter references = new FmLabStepCsvWriter(referencesPath, new string[] { "Script_UUID", "Step_UUID", "Step_Name", "Step_Index", "Ref_Type", "Ref_UUID", "Ref_Name", "File_Name", "TO_Name", "TO_UUID", "Data_Source_Name", "Data_Source_UUID", "Variable_Scope", "Usage_Type" }))
        using (FmLabStepCsvWriter calcHashes = new FmLabStepCsvWriter(calcHashesPath, new string[] { "Script_UUID", "Step_Index", "Calc_Hash", "Subrole", "File_Name" }))
        using (XmlReader reader = XmlReader.Create(inputPath, settings))
        {
            while (reader.Read())
            {
                if (reader.NodeType != XmlNodeType.Element)
                {
                    continue;
                }

                if (reader.Depth >= path.Length)
                {
                    Array.Resize(ref path, reader.Depth + 16);
                }
                path[reader.Depth] = reader.Name;

                if (reader.Depth == 0 && String.Equals(reader.Name, "FMSaveAsXML", StringComparison.Ordinal))
                {
                    fileName = NormalizeFileName(reader.GetAttribute("File"));
                    continue;
                }

                if (
                    reader.Depth == 4 &&
                    String.Equals(reader.Name, "Script", StringComparison.Ordinal) &&
                    String.Equals(path[3], "StepsForScripts", StringComparison.Ordinal)
                )
                {
                    XElement script = (XElement)XNode.ReadFrom(reader);
                    scriptCount++;
                    ProcessScript(script, fileName, steps, references, calcHashes, ref stepCount, ref referenceCount, ref calcHashCount);
                }
            }
        }

        return new string[] {
            fileName,
            scriptCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
            stepCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
            referenceCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
            calcHashCount.ToString(System.Globalization.CultureInfo.InvariantCulture)
        };
    }
}
'@
}

function Invoke-StepStreamExtract {
    param(
        [Parameter(Mandatory = $true)][string]$InputPath,
        [Parameter(Mandatory = $true)][string]$OutputDirectory
    )

    Ensure-StepStreamExtractor
    $result = [FmLabStepStreamExtractor]::Extract($InputPath, $OutputDirectory)

    return [pscustomobject]@{
        Enabled = $true
        Directory = $OutputDirectory
        FileName = $result[0]
        ScriptCount = [int64]$result[1]
        StepCount = [int64]$result[2]
        ReferenceCount = [int64]$result[3]
        CalcHashCount = [int64]$result[4]
    }
}

function Quote-SqlLiteral {
    param([AllowNull()][string]$Value)

    if ($null -eq $Value) {
        return "NULL"
    }

    return "'" + ($Value -replace "'", "''") + "'"
}

function ConvertTo-DuckDbPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    return ((Resolve-Path -LiteralPath $Path).Path -replace "\\", "/")
}

function Replace-ConvertSqlBlock {
    param(
        [Parameter(Mandatory = $true)][string]$Sql,
        [Parameter(Mandatory = $true)][string]$Pattern,
        [Parameter(Mandatory = $true)][string]$Replacement,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $options = [System.Text.RegularExpressions.RegexOptions]::Singleline
    $matches = [regex]::Matches($Sql, $Pattern, $options)
    if ($matches.Count -eq 0) {
        Write-WarnLine "Could not remove SQL block for streamed LayoutCatalog import: $Label"
        return $Sql
    }

    return [regex]::Replace(
        $Sql,
        $Pattern,
        [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $Replacement },
        $options
    )
}

function Remove-LayoutXmlParsingBlocks {
    param([Parameter(Mandatory = $true)][string]$Sql)

    $sql = $Sql
    $sql = Replace-ConvertSqlBlock `
        -Sql $sql `
        -Pattern '-- Layouts\r?\n.*?(?=-- AccountsCatalog)' `
        -Replacement "-- Layouts`r`n-- Skipped for this import: loaded via .NET streaming extractor to avoid DuckDB XML/XPath memory blowups.`r`n`r`n" `
        -Label "Layouts/LayoutParts/LayoutObjects/XMLLayoutReferences"

    $sql = Replace-ConvertSqlBlock `
        -Sql $sql `
        -Pattern '-- A\.5.*?(?=-- ============================================\r?\n-- A\.6)' `
        -Replacement "-- A.5 LayoutObject refs`r`n-- Skipped for this import: generated once from streamed LayoutObjectCalcHashes after all segments.`r`n`r`n" `
        -Label "A.5 LayoutObject refs"

    $sql = Replace-ConvertSqlBlock `
        -Sql $sql `
        -Pattern '-- A\.6\.9 PluginFunctionRef in LayoutObjects.*?(?=-- ============================================\r?\n-- A\.7)' `
        -Replacement "-- A.6.9/A.6.10 LayoutObject refs`r`n-- Skipped for this import: generated once from streamed LayoutObjectCalcHashes after all segments.`r`n`r`n" `
        -Label "A.6.9/A.6.10 LayoutObject refs"

    $sql = Replace-ConvertSqlBlock `
        -Sql $sql `
        -Pattern '-- A\.7\.5 FunctionRef in LayoutObjects.*?(?=-- ============================================\r?\n-- PHASE 4)' `
        -Replacement "-- A.7.5 LayoutObject function refs`r`n-- Skipped for this import: generated once from streamed LayoutObjectCalcHashes after all segments.`r`n`r`n" `
        -Label "A.7.5 LayoutObject refs"

    return $sql
}

function Remove-StepXmlParsingBlocks {
    param([Parameter(Mandatory = $true)][string]$Sql)

    $sql = $Sql
    $sql = Replace-ConvertSqlBlock `
        -Sql $sql `
        -Pattern '-- StepsForScripts\r?\n.*?(?=-- Layouts)' `
        -Replacement "-- StepsForScripts`r`n-- Skipped for this import: loaded via .NET streaming extractor to avoid slow DuckDB XML/XPath script-step parsing.`r`n`r`n" `
        -Label "StepsForScripts/XMLStepReferences"

    $sql = Replace-ConvertSqlBlock `
        -Sql $sql `
        -Pattern '-- A\.4.*?(?=-- ============================================\r?\n-- A\.5)' `
        -Replacement "-- A.4 Script-Step refs`r`n-- Skipped for this import: generated once from streamed StepCalcHashes after all segments.`r`n`r`n" `
        -Label "A.4 Script-Step refs"

    $sql = Replace-ConvertSqlBlock `
        -Sql $sql `
        -Pattern '-- A\.6\.7 PluginFunctionRef in Script-Steps.*?(?=-- A\.6\.9 PluginFunctionRef in LayoutObjects)' `
        -Replacement "-- A.6.7/A.6.8 Script-Step refs`r`n-- Skipped for this import: generated once from streamed StepCalcHashes after all segments.`r`n`r`n" `
        -Label "A.6.7/A.6.8 Script-Step refs"

    $sql = Replace-ConvertSqlBlock `
        -Sql $sql `
        -Pattern '-- A\.7\.4 FunctionRef in Script-Steps.*?(?=-- A\.7\.5 FunctionRef in LayoutObjects)' `
        -Replacement "-- A.7.4 Script-Step function refs`r`n-- Skipped for this import: generated once from streamed StepCalcHashes after all segments.`r`n`r`n" `
        -Label "A.7.4 Script-Step refs"

    return $sql
}

function Set-ConvertSqlVariables {
    param(
        [Parameter(Mandatory = $true)][string]$InputPath,
        [Parameter(Mandatory = $true)][string]$OutputPath,
        [Parameter(Mandatory = $true)][string]$XmlFileName,
        [bool]$PurgeReferences = $true,
        [bool]$SkipLayoutXmlParsing = $false,
        [bool]$SkipStepXmlParsing = $false
    )

    $utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
    $sql = [System.IO.File]::ReadAllText($InputPath, $utf8NoBom)

    $xmlSql = $XmlFileName -replace "'", "''"
    $versionSql = $script:SchemaVersionExpected -replace "'", "''"
    $hashSql = $script:SchemaHashExpected -replace "'", "''"

    $sql = [regex]::Replace($sql, "SET VARIABLE fm_xml = '.*?';", { "SET VARIABLE fm_xml = '$xmlSql';" })
    $sql = [regex]::Replace($sql, "SET VARIABLE schema_version = '.*?';", { "SET VARIABLE schema_version = '$versionSql';" })
    $sql = [regex]::Replace($sql, "SET VARIABLE schema_hash = '.*?';", { "SET VARIABLE schema_hash = '$hashSql';" })
    $sql = [regex]::Replace($sql, "SET VARIABLE purge_references = .*?;", { "SET VARIABLE purge_references = $($PurgeReferences.ToString().ToLowerInvariant());" })

    if ($SkipStepXmlParsing) {
        $sql = Remove-StepXmlParsingBlocks -Sql $sql
    }

    if ($SkipLayoutXmlParsing) {
        $sql = Remove-LayoutXmlParsingBlocks -Sql $sql
    }

    [System.IO.File]::WriteAllText($OutputPath, $sql, $utf8NoBom)
}

function Format-Duration {
    param([Parameter(Mandatory = $true)][TimeSpan]$Duration)

    if ($Duration.TotalHours -ge 1) {
        return ("{0}h {1}m {2:N0}s" -f [Math]::Floor($Duration.TotalHours), $Duration.Minutes, $Duration.Seconds)
    }

    if ($Duration.TotalMinutes -ge 1) {
        return ("{0}m {1:N0}s" -f [Math]::Floor($Duration.TotalMinutes), $Duration.Seconds)
    }

    return ("{0:N1}s" -f $Duration.TotalSeconds)
}

function Format-ByteSize {
    param([Parameter(Mandatory = $true)][Int64]$Bytes)

    if ($Bytes -ge 1GB) {
        return ("{0:N2} GB" -f ($Bytes / 1GB))
    }

    if ($Bytes -ge 1MB) {
        return ("{0:N2} MB" -f ($Bytes / 1MB))
    }

    if ($Bytes -ge 1KB) {
        return ("{0:N2} KB" -f ($Bytes / 1KB))
    }

    return "$Bytes B"
}

function Invoke-DuckDbSqlFile {
    param(
        [Parameter(Mandatory = $true)][string]$DatabasePath,
        [Parameter(Mandatory = $true)][string]$SqlFilePath,
        [string]$WorkingDirectory = $script:ProjectRoot,
        [string]$XmlDirEnv = "",
        [string]$ProgressLabel = "DuckDB",
        [int]$HeartbeatSeconds = 60
    )

    $duckDbOutputPath = Join-Path ([System.IO.Path]::GetTempPath()) ("fm-lab-duckdb-" + [guid]::NewGuid().ToString("N") + ".log")
    $cmd = '""{0}" "{1}" < "{2}" > "{3}" 2>&1"' -f $script:DuckDbBin, $DatabasePath, $SqlFilePath, $duckDbOutputPath
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $env:ComSpec
    if ([string]::IsNullOrWhiteSpace($psi.FileName)) {
        $psi.FileName = "cmd.exe"
    }
    $psi.Arguments = "/d /s /c $cmd"
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    if (-not [string]::IsNullOrWhiteSpace($XmlDirEnv)) {
        $psi.EnvironmentVariables["FM_XML_DIR"] = $XmlDirEnv
    }

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $null = $process.Start()
        $lastHeartbeat = 0

        while (-not $process.WaitForExit(1000)) {
            $elapsedSeconds = [int]$watch.Elapsed.TotalSeconds
            $dbSizeBytes = 0
            if (Test-Path -LiteralPath $DatabasePath) {
                $dbSizeBytes = (Get-Item -LiteralPath $DatabasePath).Length
            }
            Write-Progress -Id 30 -Activity $ProgressLabel -Status ("DuckDB running; DB written {0}; elapsed {1}" -f (Format-ByteSize -Bytes $dbSizeBytes), (Format-Duration -Duration $watch.Elapsed))
            if ($HeartbeatSeconds -gt 0 -and ($elapsedSeconds - $lastHeartbeat) -ge $HeartbeatSeconds) {
                $lastHeartbeat = $elapsedSeconds
                $dbSize = "not created yet"
                if (Test-Path -LiteralPath $DatabasePath) {
                    $dbSize = Format-ByteSize -Bytes (Get-Item -LiteralPath $DatabasePath).Length
                }
                Write-Host ("  {0}: still running after {1}; DB size: {2}" -f $ProgressLabel, (Format-Duration -Duration $watch.Elapsed), $dbSize)
            }
        }

        $process.WaitForExit()
        $watch.Stop()
        Write-Progress -Id 30 -Activity $ProgressLabel -Completed
        Write-Host ("  {0}: finished in {1} (exit {2})" -f $ProgressLabel, (Format-Duration -Duration $watch.Elapsed), $process.ExitCode)

        $output = ""
        if (Test-Path -LiteralPath $duckDbOutputPath) {
            $output = [System.IO.File]::ReadAllText($duckDbOutputPath)
        }

        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Output = $output
            Duration = $watch.Elapsed
        }
    } finally {
        Remove-Item -LiteralPath $duckDbOutputPath -Force -ErrorAction SilentlyContinue
    }
}

function New-LayoutStreamLoadSql {
    param([Parameter(Mandatory = $true)]$LayoutStream)

    $fileSql = Quote-SqlLiteral -Value $LayoutStream.FileName
    $layoutsCsv = Quote-SqlLiteral -Value (ConvertTo-DuckDbPath -Path (Join-Path $LayoutStream.Directory "layouts.csv"))
    $partsCsv = Quote-SqlLiteral -Value (ConvertTo-DuckDbPath -Path (Join-Path $LayoutStream.Directory "layout_parts.csv"))
    $objectsCsv = Quote-SqlLiteral -Value (ConvertTo-DuckDbPath -Path (Join-Path $LayoutStream.Directory "layout_objects.csv"))
    $referencesCsv = Quote-SqlLiteral -Value (ConvertTo-DuckDbPath -Path (Join-Path $LayoutStream.Directory "layout_references.csv"))
    $calcHashesCsv = Quote-SqlLiteral -Value (ConvertTo-DuckDbPath -Path (Join-Path $LayoutStream.Directory "layout_object_calc_hashes.csv"))

    return @"
SET threads=4;
SET preserve_insertion_order=false;

CREATE TABLE IF NOT EXISTS Layouts (
    L_ID BIGINT,
    L_Name VARCHAR,
    L_UUID VARCHAR,
    L_TO_Name VARCHAR,
    Folder_Type VARCHAR,
    Is_Separator BOOLEAN,
    Sequence_ID BIGINT,
    File_Name VARCHAR,
    PRIMARY KEY (L_UUID, File_Name)
);

CREATE TABLE IF NOT EXISTS LayoutParts (
    Layout_ID BIGINT,
    Layout_Name VARCHAR,
    Part_Type VARCHAR,
    Part_Kind INTEGER,
    Definition_Type VARCHAR,
    Definition_Kind INTEGER,
    Part_Size INTEGER,
    Part_Absolute INTEGER,
    Part_Options INTEGER,
    Object_Count BIGINT,
    File_Name VARCHAR,
    PRIMARY KEY (Layout_ID, Part_Kind, File_Name)
);

CREATE TABLE IF NOT EXISTS LayoutObjects (
    Layout_ID BIGINT,
    Part_Type VARCHAR,
    Object_ID BIGINT,
    Object_Type VARCHAR,
    Object_Name VARCHAR,
    Object_Kind INTEGER,
    Object_Hash VARCHAR,
    Object_UUID VARCHAR,
    Bounds_Top INTEGER,
    Bounds_Left INTEGER,
    Bounds_Bottom INTEGER,
    Bounds_Right INTEGER,
    Parent_Object_ID BIGINT,
    Nesting_Level INTEGER,
    Z_Order INTEGER,
    Hide_Calculation_Text VARCHAR,
    Tooltip_Calculation_Text VARCHAR,
    Label_Calculation_Text VARCHAR,
    ScriptTrigger_Parameter_Text VARCHAR,
    Text_Content VARCHAR,
    Object_XML VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Object_UUID, File_Name)
);

CREATE TABLE IF NOT EXISTS XMLLayoutReferences (
    Object_UUID VARCHAR,
    Ref_Type VARCHAR,
    Ref_UUID VARCHAR,
    Ref_Name VARCHAR,
    File_Name VARCHAR
);

CREATE TABLE IF NOT EXISTS LayoutObjectCalcHashes (
    Object_UUID VARCHAR,
    Calc_Hash VARCHAR,
    Subrole VARCHAR,
    File_Name VARCHAR
);

DELETE FROM Layouts WHERE File_Name = $fileSql;
DELETE FROM LayoutParts WHERE File_Name = $fileSql;
DELETE FROM LayoutObjects WHERE File_Name = $fileSql;
DELETE FROM XMLLayoutReferences WHERE File_Name = $fileSql;
DELETE FROM LayoutObjectCalcHashes WHERE File_Name = $fileSql;

CREATE TEMP TABLE stream_layouts AS
SELECT * FROM read_csv(
    $layoutsCsv,
    header=true,
    nullstr='',
    columns={
        'L_ID':'BIGINT',
        'L_Name':'VARCHAR',
        'L_UUID':'VARCHAR',
        'L_TO_Name':'VARCHAR',
        'Folder_Type':'VARCHAR',
        'Is_Separator':'BOOLEAN',
        'Sequence_ID':'BIGINT',
        'File_Name':'VARCHAR'
    }
);

INSERT INTO Layouts
SELECT * FROM stream_layouts
WHERE L_UUID IS NOT NULL
ON CONFLICT (L_UUID, File_Name) DO UPDATE SET
    L_ID = EXCLUDED.L_ID,
    L_Name = EXCLUDED.L_Name,
    L_TO_Name = EXCLUDED.L_TO_Name,
    Folder_Type = EXCLUDED.Folder_Type,
    Is_Separator = EXCLUDED.Is_Separator,
    Sequence_ID = EXCLUDED.Sequence_ID;

CREATE TEMP TABLE stream_layout_parts AS
SELECT * FROM read_csv(
    $partsCsv,
    header=true,
    nullstr='',
    columns={
        'Layout_ID':'BIGINT',
        'Layout_Name':'VARCHAR',
        'Part_Type':'VARCHAR',
        'Part_Kind':'INTEGER',
        'Definition_Type':'VARCHAR',
        'Definition_Kind':'INTEGER',
        'Part_Size':'INTEGER',
        'Part_Absolute':'INTEGER',
        'Part_Options':'INTEGER',
        'Object_Count':'BIGINT',
        'File_Name':'VARCHAR'
    }
);

INSERT INTO LayoutParts
SELECT * FROM stream_layout_parts
WHERE Layout_ID IS NOT NULL AND Part_Kind IS NOT NULL
ON CONFLICT (Layout_ID, Part_Kind, File_Name) DO UPDATE SET
    Layout_Name = EXCLUDED.Layout_Name,
    Part_Type = EXCLUDED.Part_Type,
    Definition_Type = EXCLUDED.Definition_Type,
    Definition_Kind = EXCLUDED.Definition_Kind,
    Part_Size = EXCLUDED.Part_Size,
    Part_Absolute = EXCLUDED.Part_Absolute,
    Part_Options = EXCLUDED.Part_Options,
    Object_Count = EXCLUDED.Object_Count;

CREATE TEMP TABLE stream_layout_objects AS
SELECT * FROM read_csv(
    $objectsCsv,
    header=true,
    nullstr='',
    max_line_size=1000000000,
    columns={
        'Layout_ID':'BIGINT',
        'Part_Type':'VARCHAR',
        'Object_ID':'BIGINT',
        'Object_Type':'VARCHAR',
        'Object_Name':'VARCHAR',
        'Object_Kind':'INTEGER',
        'Object_Hash':'VARCHAR',
        'Object_UUID':'VARCHAR',
        'Bounds_Top':'INTEGER',
        'Bounds_Left':'INTEGER',
        'Bounds_Bottom':'INTEGER',
        'Bounds_Right':'INTEGER',
        'Parent_Object_ID':'BIGINT',
        'Nesting_Level':'INTEGER',
        'Z_Order':'INTEGER',
        'Hide_Calculation_Text':'VARCHAR',
        'Tooltip_Calculation_Text':'VARCHAR',
        'Label_Calculation_Text':'VARCHAR',
        'ScriptTrigger_Parameter_Text':'VARCHAR',
        'Text_Content':'VARCHAR',
        'Object_XML':'VARCHAR',
        'File_Name':'VARCHAR'
    }
);

INSERT INTO LayoutObjects
SELECT * FROM stream_layout_objects
WHERE Object_UUID IS NOT NULL
ON CONFLICT (Object_UUID, File_Name) DO UPDATE SET
    Layout_ID = EXCLUDED.Layout_ID,
    Part_Type = EXCLUDED.Part_Type,
    Object_ID = EXCLUDED.Object_ID,
    Object_Type = EXCLUDED.Object_Type,
    Object_Name = EXCLUDED.Object_Name,
    Object_Kind = EXCLUDED.Object_Kind,
    Object_Hash = EXCLUDED.Object_Hash,
    Bounds_Top = EXCLUDED.Bounds_Top,
    Bounds_Left = EXCLUDED.Bounds_Left,
    Bounds_Bottom = EXCLUDED.Bounds_Bottom,
    Bounds_Right = EXCLUDED.Bounds_Right,
    Parent_Object_ID = EXCLUDED.Parent_Object_ID,
    Nesting_Level = EXCLUDED.Nesting_Level,
    Z_Order = EXCLUDED.Z_Order,
    Hide_Calculation_Text = EXCLUDED.Hide_Calculation_Text,
    Tooltip_Calculation_Text = EXCLUDED.Tooltip_Calculation_Text,
    Label_Calculation_Text = EXCLUDED.Label_Calculation_Text,
    ScriptTrigger_Parameter_Text = EXCLUDED.ScriptTrigger_Parameter_Text,
    Text_Content = EXCLUDED.Text_Content,
    Object_XML = EXCLUDED.Object_XML;

CREATE TEMP TABLE stream_layout_references AS
SELECT * FROM read_csv(
    $referencesCsv,
    header=true,
    nullstr='',
    columns={
        'Object_UUID':'VARCHAR',
        'Ref_Type':'VARCHAR',
        'Ref_UUID':'VARCHAR',
        'Ref_Name':'VARCHAR',
        'File_Name':'VARCHAR'
    }
);

INSERT INTO XMLLayoutReferences
SELECT * FROM stream_layout_references
WHERE Object_UUID IS NOT NULL AND Ref_UUID IS NOT NULL;

CREATE TEMP TABLE stream_layout_calc_hashes AS
SELECT * FROM read_csv(
    $calcHashesCsv,
    header=true,
    nullstr='',
    columns={
        'Object_UUID':'VARCHAR',
        'Calc_Hash':'VARCHAR',
        'Subrole':'VARCHAR',
        'File_Name':'VARCHAR'
    }
);

INSERT INTO LayoutObjectCalcHashes
SELECT * FROM stream_layout_calc_hashes
WHERE Object_UUID IS NOT NULL AND Calc_Hash IS NOT NULL;

-- LayoutObject FieldRef
INSERT INTO XMLCalcReferences
SELECT
    h.Object_UUID, 'LayoutObject', NULL, h.Subrole,
    h.Calc_Hash, 'field',
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*UUID="([^"]+)"', 1),
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*name="([^"]+)"', 1),
    h.File_Name,
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*name="([^"]+)"', 1), ''),
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*UUID="([^"]+)"', 1), ''),
    NULL, NULL,
    NULL
FROM LayoutObjectCalcHashes h
JOIN DDR_Calculations d
  ON h.Calc_Hash = d.Calc_Hash
 AND h.File_Name = d.File_Name
WHERE h.File_Name = $fileSql
  AND d.Chunk_Type = 'FieldRef';

-- LayoutObject CustomFunctionRef
INSERT INTO XMLCalcReferences
SELECT
    h.Object_UUID, 'LayoutObject', NULL, h.Subrole,
    h.Calc_Hash, 'customfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    h.File_Name,
    NULL, NULL,
    NULL, NULL,
    NULL
FROM LayoutObjectCalcHashes h
JOIN DDR_Calculations d
  ON h.Calc_Hash = d.Calc_Hash
 AND h.File_Name = d.File_Name
WHERE h.File_Name = $fileSql
  AND d.Chunk_Type = 'CustomFunctionRef';

-- LayoutObject PluginFunctionUsages
INSERT INTO PluginFunctionUsages
SELECT
    h.Object_UUID, 'LayoutObject', NULL, h.Subrole,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    h.Calc_Hash,
    h.File_Name,
    d.Calc_UUID,
    d.Chunk_Index
FROM LayoutObjectCalcHashes h
JOIN DDR_Calculations d
  ON h.Calc_Hash = d.Calc_Hash
 AND h.File_Name = d.File_Name
WHERE h.File_Name = $fileSql
  AND d.Chunk_Type = 'PluginFunctionRef';

-- LayoutObject PluginFunctionRef
INSERT INTO XMLCalcReferences
SELECT
    h.Object_UUID, 'LayoutObject', NULL, h.Subrole,
    h.Calc_Hash, 'pluginfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    h.File_Name,
    NULL, NULL,
    NULL, NULL,
    m.SubName
FROM LayoutObjectCalcHashes h
JOIN DDR_Calculations d
  ON h.Calc_Hash = d.Calc_Hash
 AND h.File_Name = d.File_Name
LEFT JOIN MBS_SubnameMap m
       ON m.Calc_UUID = d.Calc_UUID
      AND m.File_Name = d.File_Name
      AND m.Plugin_Chunk_Index = d.Chunk_Index
WHERE h.File_Name = $fileSql
  AND d.Chunk_Type = 'PluginFunctionRef';

-- LayoutObject VariableReference
INSERT INTO XMLCalcReferences
SELECT
    h.Object_UUID, 'LayoutObject', NULL, h.Subrole,
    h.Calc_Hash, 'variable',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    h.File_Name,
    NULL, NULL,
    CASE
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '`$`$`$%' THEN 'superglobal'
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '`$`$%'  THEN 'global'
        ELSE 'local'
    END,
    'read',
    NULL
FROM LayoutObjectCalcHashes h
JOIN DDR_Calculations d
  ON h.Calc_Hash = d.Calc_Hash
 AND h.File_Name = d.File_Name
WHERE h.File_Name = $fileSql
  AND d.Chunk_Type = 'VariableReference';

-- LayoutObject built-in FunctionRef
INSERT INTO XMLCalcReferences
SELECT
    h.Object_UUID, 'LayoutObject', NULL, h.Subrole,
    h.Calc_Hash, 'function',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    h.File_Name,
    NULL, NULL,
    NULL, NULL,
    CASE WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) = 'Get'
         THEN g.SubParameter ELSE NULL END
FROM LayoutObjectCalcHashes h
JOIN DDR_Calculations d
  ON h.Calc_Hash = d.Calc_Hash
 AND h.File_Name = d.File_Name
LEFT JOIN GetSubparameterMap g
       ON g.Calc_UUID = d.Calc_UUID
      AND g.File_Name = d.File_Name
      AND g.Get_Chunk_Index = d.Chunk_Index
WHERE h.File_Name = $fileSql
  AND d.Chunk_Type = 'FunctionRef';
"@
}

function Invoke-LoadStreamedLayouts {
    param(
        [Parameter(Mandatory = $true)]$LayoutStream,
        [Parameter(Mandatory = $true)][string]$TempDirectory
    )

    $sqlPath = Join-Path $TempDirectory "load_streamed_layouts.sql"
    $utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
    [System.IO.File]::WriteAllText($sqlPath, (New-LayoutStreamLoadSql -LayoutStream $LayoutStream), $utf8NoBom)

    return Invoke-DuckDbSqlFile `
        -DatabasePath $script:DbFile `
        -SqlFilePath $sqlPath `
        -WorkingDirectory $script:ProjectRoot `
        -ProgressLabel "DuckDB streamed LayoutCatalog load" `
        -HeartbeatSeconds 30
}

function New-StepStreamLoadSql {
    param([Parameter(Mandatory = $true)]$StepStream)

    $fileSql = Quote-SqlLiteral -Value $StepStream.FileName
    $stepsCsv = Quote-SqlLiteral -Value (ConvertTo-DuckDbPath -Path (Join-Path $StepStream.Directory "steps_for_scripts.csv"))
    $referencesCsv = Quote-SqlLiteral -Value (ConvertTo-DuckDbPath -Path (Join-Path $StepStream.Directory "step_references.csv"))
    $calcHashesCsv = Quote-SqlLiteral -Value (ConvertTo-DuckDbPath -Path (Join-Path $StepStream.Directory "step_calc_hashes.csv"))

    return @"
SET threads=4;
SET preserve_insertion_order=false;

CREATE TABLE IF NOT EXISTS StepsForScripts (
    Script_ID BIGINT,
    Script_Name VARCHAR,
    Script_UUID VARCHAR,
    Step_Index INTEGER,
    Step_ID INTEGER,
    Step_Name VARCHAR,
    Is_Enabled BOOLEAN,
    Step_UUID VARCHAR,
    DDR_Hash VARCHAR,
    DDR_UUID VARCHAR,
    Parameters_XML VARCHAR,
    Parameter_Type VARCHAR,
    Variable_Name VARCHAR,
    Calculation_Text VARCHAR,
    Boolean_Type VARCHAR,
    Boolean_Value VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Step_UUID, File_Name)
);

CREATE TABLE IF NOT EXISTS XMLStepReferences (
    Script_UUID VARCHAR,
    Step_UUID VARCHAR,
    Step_Name VARCHAR,
    Step_Index VARCHAR,
    Ref_Type VARCHAR,
    Ref_UUID VARCHAR,
    Ref_Name VARCHAR,
    File_Name VARCHAR,
    TO_Name VARCHAR,
    TO_UUID VARCHAR,
    Data_Source_Name VARCHAR,
    Data_Source_UUID VARCHAR,
    Variable_Scope VARCHAR,
    Usage_Type VARCHAR
);

ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS TO_Name VARCHAR;
ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS TO_UUID VARCHAR;
ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS Data_Source_Name VARCHAR;
ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS Data_Source_UUID VARCHAR;
ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS Variable_Scope VARCHAR;
ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS Usage_Type VARCHAR;

CREATE TABLE IF NOT EXISTS StepCalcHashes (
    Script_UUID VARCHAR,
    Step_Index VARCHAR,
    Calc_Hash VARCHAR,
    Subrole VARCHAR,
    File_Name VARCHAR
);

DELETE FROM StepsForScripts WHERE File_Name = $fileSql;
DELETE FROM XMLStepReferences WHERE File_Name = $fileSql;
DELETE FROM StepCalcHashes WHERE File_Name = $fileSql;

CREATE TEMP TABLE stream_steps_for_scripts AS
SELECT * FROM read_csv(
    $stepsCsv,
    header=true,
    nullstr='',
    max_line_size=1000000000,
    columns={
        'Script_ID':'BIGINT',
        'Script_Name':'VARCHAR',
        'Script_UUID':'VARCHAR',
        'Step_Index':'INTEGER',
        'Step_ID':'INTEGER',
        'Step_Name':'VARCHAR',
        'Is_Enabled':'BOOLEAN',
        'Step_UUID':'VARCHAR',
        'DDR_Hash':'VARCHAR',
        'DDR_UUID':'VARCHAR',
        'Parameters_XML':'VARCHAR',
        'Parameter_Type':'VARCHAR',
        'Variable_Name':'VARCHAR',
        'Calculation_Text':'VARCHAR',
        'Boolean_Type':'VARCHAR',
        'Boolean_Value':'VARCHAR',
        'File_Name':'VARCHAR'
    }
);

INSERT INTO StepsForScripts
SELECT * FROM stream_steps_for_scripts
WHERE Step_UUID IS NOT NULL
ON CONFLICT (Step_UUID, File_Name) DO UPDATE SET
    Script_ID = EXCLUDED.Script_ID,
    Script_Name = EXCLUDED.Script_Name,
    Script_UUID = EXCLUDED.Script_UUID,
    Step_Index = EXCLUDED.Step_Index,
    Step_ID = EXCLUDED.Step_ID,
    Step_Name = EXCLUDED.Step_Name,
    Is_Enabled = EXCLUDED.Is_Enabled,
    DDR_Hash = EXCLUDED.DDR_Hash,
    DDR_UUID = EXCLUDED.DDR_UUID,
    Parameters_XML = EXCLUDED.Parameters_XML,
    Parameter_Type = EXCLUDED.Parameter_Type,
    Variable_Name = EXCLUDED.Variable_Name,
    Calculation_Text = EXCLUDED.Calculation_Text,
    Boolean_Type = EXCLUDED.Boolean_Type,
    Boolean_Value = EXCLUDED.Boolean_Value;

CREATE TEMP TABLE stream_step_references AS
SELECT * FROM read_csv(
    $referencesCsv,
    header=true,
    nullstr='',
    columns={
        'Script_UUID':'VARCHAR',
        'Step_UUID':'VARCHAR',
        'Step_Name':'VARCHAR',
        'Step_Index':'VARCHAR',
        'Ref_Type':'VARCHAR',
        'Ref_UUID':'VARCHAR',
        'Ref_Name':'VARCHAR',
        'File_Name':'VARCHAR',
        'TO_Name':'VARCHAR',
        'TO_UUID':'VARCHAR',
        'Data_Source_Name':'VARCHAR',
        'Data_Source_UUID':'VARCHAR',
        'Variable_Scope':'VARCHAR',
        'Usage_Type':'VARCHAR'
    }
);

INSERT INTO XMLStepReferences
SELECT * FROM stream_step_references
WHERE Step_UUID IS NOT NULL;

CREATE TEMP TABLE stream_step_calc_hashes AS
SELECT * FROM read_csv(
    $calcHashesCsv,
    header=true,
    nullstr='',
    columns={
        'Script_UUID':'VARCHAR',
        'Step_Index':'VARCHAR',
        'Calc_Hash':'VARCHAR',
        'Subrole':'VARCHAR',
        'File_Name':'VARCHAR'
    }
);

INSERT INTO StepCalcHashes
SELECT * FROM stream_step_calc_hashes
WHERE Script_UUID IS NOT NULL AND Calc_Hash IS NOT NULL;

-- Script-Step FieldRef
INSERT INTO XMLCalcReferences
SELECT
    h.Script_UUID, 'Script', h.Step_Index, h.Subrole,
    h.Calc_Hash, 'field',
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*UUID="([^"]+)"', 1),
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*name="([^"]+)"', 1),
    h.File_Name,
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*name="([^"]+)"', 1), ''),
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*UUID="([^"]+)"', 1), ''),
    NULL, NULL,
    NULL
FROM StepCalcHashes h
JOIN DDR_Calculations d
  ON h.Calc_Hash = d.Calc_Hash
 AND h.File_Name = d.File_Name
WHERE h.File_Name = $fileSql
  AND d.Chunk_Type = 'FieldRef';

-- Script-Step CustomFunctionRef
INSERT INTO XMLCalcReferences
SELECT
    h.Script_UUID, 'Script', h.Step_Index, h.Subrole,
    h.Calc_Hash, 'customfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    h.File_Name,
    NULL, NULL,
    NULL, NULL,
    NULL
FROM StepCalcHashes h
JOIN DDR_Calculations d
  ON h.Calc_Hash = d.Calc_Hash
 AND h.File_Name = d.File_Name
WHERE h.File_Name = $fileSql
  AND d.Chunk_Type = 'CustomFunctionRef';

-- Script-Step PluginFunctionUsages
INSERT INTO PluginFunctionUsages
SELECT
    h.Script_UUID, 'Script', h.Step_Index, h.Subrole,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    h.Calc_Hash,
    h.File_Name,
    d.Calc_UUID,
    d.Chunk_Index
FROM StepCalcHashes h
JOIN DDR_Calculations d
  ON h.Calc_Hash = d.Calc_Hash
 AND h.File_Name = d.File_Name
WHERE h.File_Name = $fileSql
  AND d.Chunk_Type = 'PluginFunctionRef';

-- Script-Step PluginFunctionRef
INSERT INTO XMLCalcReferences
SELECT
    h.Script_UUID, 'Script', h.Step_Index, h.Subrole,
    h.Calc_Hash, 'pluginfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    h.File_Name,
    NULL, NULL,
    NULL, NULL,
    m.SubName
FROM StepCalcHashes h
JOIN DDR_Calculations d
  ON h.Calc_Hash = d.Calc_Hash
 AND h.File_Name = d.File_Name
LEFT JOIN MBS_SubnameMap m
       ON m.Calc_UUID = d.Calc_UUID
      AND m.File_Name = d.File_Name
      AND m.Plugin_Chunk_Index = d.Chunk_Index
WHERE h.File_Name = $fileSql
  AND d.Chunk_Type = 'PluginFunctionRef';

-- Script-Step VariableReference
INSERT INTO XMLCalcReferences
SELECT
    h.Script_UUID, 'Script', h.Step_Index, h.Subrole,
    h.Calc_Hash, 'variable',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    h.File_Name,
    NULL, NULL,
    CASE
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '`$`$`$%' THEN 'superglobal'
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '`$`$%'  THEN 'global'
        ELSE 'local'
    END,
    'read',
    NULL
FROM StepCalcHashes h
JOIN DDR_Calculations d
  ON h.Calc_Hash = d.Calc_Hash
 AND h.File_Name = d.File_Name
WHERE h.File_Name = $fileSql
  AND d.Chunk_Type = 'VariableReference';

-- Script-Step built-in FunctionRef
INSERT INTO XMLCalcReferences
SELECT
    h.Script_UUID, 'Script', h.Step_Index, h.Subrole,
    h.Calc_Hash, 'function',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    h.File_Name,
    NULL, NULL,
    NULL, NULL,
    CASE WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) = 'Get'
         THEN g.SubParameter ELSE NULL END
FROM StepCalcHashes h
JOIN DDR_Calculations d
  ON h.Calc_Hash = d.Calc_Hash
 AND h.File_Name = d.File_Name
LEFT JOIN GetSubparameterMap g
       ON g.Calc_UUID = d.Calc_UUID
      AND g.File_Name = d.File_Name
      AND g.Get_Chunk_Index = d.Chunk_Index
WHERE h.File_Name = $fileSql
  AND d.Chunk_Type = 'FunctionRef';
"@
}

function Invoke-LoadStreamedSteps {
    param(
        [Parameter(Mandatory = $true)]$StepStream,
        [Parameter(Mandatory = $true)][string]$TempDirectory
    )

    $sqlPath = Join-Path $TempDirectory "load_streamed_steps.sql"
    $utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
    [System.IO.File]::WriteAllText($sqlPath, (New-StepStreamLoadSql -StepStream $StepStream), $utf8NoBom)

    return Invoke-DuckDbSqlFile `
        -DatabasePath $script:DbFile `
        -SqlFilePath $sqlPath `
        -WorkingDirectory $script:ProjectRoot `
        -ProgressLabel "DuckDB streamed StepsForScripts load" `
        -HeartbeatSeconds 30
}

function Invoke-SyncToRestApi {
    if ($script:TestMode) {
        return
    }

    if (-not (Test-Path -LiteralPath $script:DbFile)) {
        Write-WarnLine "Skipping rest-api sync: master DB not found at $script:DbFile"
        return
    }

    New-Item -ItemType Directory -Force -Path $script:RestApiDbDir | Out-Null
    $tempTarget = "$script:RestApiDbFile.tmp"

    try {
        Ensure-FileReleased -Path $script:RestApiDbFile -Purpose "sync the updated database to the REST API"
        Ensure-FileReleased -Path "$script:RestApiDbFile.wal" -Purpose "sync the updated database to the REST API"
        Copy-Item -LiteralPath $script:DbFile -Destination $tempTarget -Force
        Move-Item -LiteralPath $tempTarget -Destination $script:RestApiDbFile -Force
        Write-Info "Synced master DB to $script:RestApiDbFile"
    } catch {
        Write-WarnLine "Sync to rest-api/db/ failed. Close the program that locks the database and retry. $($_.Exception.Message)"
        Remove-Item -LiteralPath $tempTarget -Force -ErrorAction SilentlyContinue
        return
    }

    try {
        $headers = @{}
        if (-not [string]::IsNullOrWhiteSpace($env:ADMIN_RELOAD_TOKEN)) {
            $headers["X-Admin-Token"] = $env:ADMIN_RELOAD_TOKEN
        }

        $response = Invoke-WebRequest -Uri $script:RestApiReloadUrl -Method Post -Headers $headers -TimeoutSec 5 -UseBasicParsing
        if ($response.StatusCode -eq 200) {
            Write-Info "REST-API reload triggered ($script:RestApiReloadUrl)"
        } else {
            Write-WarnLine "REST-API reload returned HTTP $($response.StatusCode)"
        }
    } catch {
        Write-WarnLine "REST-API not reachable at $script:RestApiReloadUrl (ok if not running)"
    }
}

function Invoke-ProcessSingleFile {
    param([Parameter(Mandatory = $true)][string]$FileName)

    $messages = New-Object System.Collections.Generic.List[string]
    function Add-Message {
        param([string]$Message)
        $messages.Add($Message)
        Write-Host $Message
    }

    $sourcePath = Join-Path $script:XmlDir $FileName
    if (-not (Test-Path -LiteralPath $sourcePath)) {
        Add-Message "ERROR: File not found: $FileName"
        return [pscustomobject]@{ Code = 1; Messages = $messages }
    }

    $fileTotalWatch = [System.Diagnostics.Stopwatch]::StartNew()
    $sourceSize = (Get-Item -LiteralPath $sourcePath).Length
    Add-Message ("  Source size: {0}" -f (Format-ByteSize -Bytes $sourceSize))

    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("fm-lab-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

    try {
        $stageWatch = [System.Diagnostics.Stopwatch]::StartNew()
        $encoding = Get-XmlEncodingName -Path $sourcePath
        $xmlFile = $FileName
        $workingXmlPath = Join-Path $tempDir $xmlFile

        if ($encoding -eq "utf-16le" -or $encoding -eq "utf-16be") {
            Add-Message "  Converting from $encoding to UTF-8..."
            $baseName = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
            $xmlFile = "${baseName}_utf8.xml"
            $workingXmlPath = Join-Path $tempDir $xmlFile
            Convert-ToUtf8File -SourcePath $sourcePath -TargetPath $workingXmlPath -EncodingName $encoding
        } else {
            Add-Message "  File is already UTF-8 compatible (detected: $encoding)"
            Copy-FileWithProgress -SourcePath $sourcePath -TargetPath $workingXmlPath -Label "Copying XML to temp" -ProgressId 11
        }
        $stageWatch.Stop()
        $workingSize = (Get-Item -LiteralPath $workingXmlPath).Length
        Add-Message ("  Stage encoding/copy done in {0}; temp size: {1}" -f (Format-Duration -Duration $stageWatch.Elapsed), (Format-ByteSize -Bytes $workingSize))

        $stageWatch.Restart()
        $rootElement = Get-XmlRootElement -Path $workingXmlPath
        if ($rootElement -eq "FMDynamicTemplate") {
            Add-Message "  WARNING: Skipped - legacy SaXML v2.0.0.0 format (FMDynamicTemplate)"
            Add-Message "  This format (FileMaker 18.x) is not supported. Minimum: SaXML v2.1.0.0 (FileMaker 19+)."
            return [pscustomobject]@{ Code = 4; Messages = $messages }
        }

        if ([string]::IsNullOrWhiteSpace($rootElement)) {
            Add-Message "  WARNING: Skipped - could not detect XML root element (expected FMSaveAsXML)"
            return [pscustomobject]@{ Code = 4; Messages = $messages }
        }
        $stageWatch.Stop()
        Add-Message ("  Stage root validation done in {0}; root: {1}" -f (Format-Duration -Duration $stageWatch.Elapsed), $rootElement)

        $stageWatch.Restart()
        $preprocessedFile = ([System.IO.Path]::GetFileNameWithoutExtension($xmlFile)) + "_clean.xml"
        $preprocessedPath = Join-Path $tempDir $preprocessedFile
        $preprocess = Invoke-XmlPreprocess -InputPath $workingXmlPath -OutputPath $preprocessedPath
        $stageWatch.Stop()
        Add-Message ("  Stage preprocess done in {0}; output size: {1}; replaced_cr={2}; stripped_invalid={3}" -f (Format-Duration -Duration $stageWatch.Elapsed), (Format-ByteSize -Bytes $preprocess.OutputSize), $preprocess.ReplacedCr, $preprocess.StrippedInvalid)

        $useSegments = $sourceSize -gt $script:LargeXmlThresholdBytes
        $layoutStream = $null
        $stepStream = $null
        if ($useSegments) {
            if ($script:StreamLargeLayouts) {
                $layoutStreamDir = Join-Path $tempDir "layout-stream"
                $stageWatch.Restart()
                Add-Message "  Large XML LayoutCatalog optimization: streaming layouts to CSV staging..."
                $layoutStream = Invoke-LayoutStreamExtract -InputPath $preprocessedPath -OutputDirectory $layoutStreamDir
                $stageWatch.Stop()
                Add-Message ("  Stage streamed LayoutCatalog done in {0}; layouts={1}; parts={2}; objects={3}; refs={4}; calc_hashes={5}" -f (Format-Duration -Duration $stageWatch.Elapsed), $layoutStream.LayoutCount, $layoutStream.PartCount, $layoutStream.ObjectCount, $layoutStream.ReferenceCount, $layoutStream.CalcHashCount)

                if ($layoutStream.LayoutCount -eq 0) {
                    Add-Message "  WARNING: Streamed LayoutCatalog contained no layouts; falling back to normal XML layout parsing."
                    $layoutStream = $null
                }
            } else {
                Add-Message "  Large XML LayoutCatalog optimization disabled by FM_LAB_STREAM_LAYOUTS=0."
            }

            if ($script:StreamLargeSteps) {
                $stepStreamDir = Join-Path $tempDir "step-stream"
                $stageWatch.Restart()
                Add-Message "  Large XML StepsForScripts optimization: streaming script steps to CSV staging..."
                $stepStream = Invoke-StepStreamExtract -InputPath $preprocessedPath -OutputDirectory $stepStreamDir
                $stageWatch.Stop()
                Add-Message ("  Stage streamed StepsForScripts done in {0}; scripts={1}; steps={2}; refs={3}; calc_hashes={4}" -f (Format-Duration -Duration $stageWatch.Elapsed), $stepStream.ScriptCount, $stepStream.StepCount, $stepStream.ReferenceCount, $stepStream.CalcHashCount)

                if ($stepStream.StepCount -eq 0) {
                    Add-Message "  WARNING: Streamed StepsForScripts contained no steps; falling back to normal XML script-step parsing."
                    $stepStream = $null
                }
            } else {
                Add-Message "  Large XML StepsForScripts optimization disabled by FM_LAB_STREAM_STEPS=0."
            }

            $segmentDir = Join-Path $tempDir "segments"
            $stageWatch.Restart()
            $skipCatalogNames = @()
            if ($null -ne $layoutStream) {
                $skipCatalogNames += "LayoutCatalog"
            }
            if ($null -ne $stepStream) {
                $skipCatalogNames += "StepsForScripts"
            }
            $splitMessage = "  Large XML detected (> {0}); splitting into catalog segments with {1} max target" -f (Format-ByteSize -Bytes $script:LargeXmlThresholdBytes), (Format-ByteSize -Bytes $script:LargeSegmentTargetBytes)
            if ($null -ne $layoutStream) {
                $splitMessage += "; LayoutCatalog skipped because it was streamed"
            } else {
                $splitMessage += "; LayoutCatalog additionally max $script:LargeSegmentMaxItems layouts per segment"
            }
            if ($null -ne $stepStream) {
                $splitMessage += "; StepsForScripts skipped because it was streamed"
            }
            Add-Message ($splitMessage + "...")
            $segmentFiles = @(Split-XmlIntoCatalogSegments -InputPath $preprocessedPath -OutputDirectory $segmentDir -SkipCatalogNames $skipCatalogNames)
            $stageWatch.Stop()
            Add-Message ("  Stage segmentation done in {0}; segments={1}" -f (Format-Duration -Duration $stageWatch.Elapsed), $segmentFiles.Count)

            if ($segmentFiles.Count -eq 0) {
                Add-Message "  ERROR: Segmentation produced no catalog files"
                return [pscustomobject]@{ Code = 5; Messages = $messages }
            }

            $segmentIndex = 0
            $result = $null
            foreach ($segmentFile in $segmentFiles) {
                $segmentIndex++
                $segmentPath = Join-Path $segmentDir $segmentFile
                $segmentSize = (Get-Item -LiteralPath $segmentPath).Length
                $purgeReferences = $segmentIndex -eq 1
                $tempSql = Join-Path $tempDir ("convert_segment_{0:000}.sql" -f $segmentIndex)

                $stageWatch.Restart()
                Set-ConvertSqlVariables -InputPath $script:SqlTemplate -OutputPath $tempSql -XmlFileName $segmentFile -PurgeReferences $purgeReferences -SkipLayoutXmlParsing ($null -ne $layoutStream) -SkipStepXmlParsing ($null -ne $stepStream)
                $stageWatch.Stop()

                Add-Message ("  [{0}/{1}] Segment {2} ({3}); purge_references={4}; SQL prepared in {5}" -f $segmentIndex, $segmentFiles.Count, $segmentFile, (Format-ByteSize -Bytes $segmentSize), $purgeReferences.ToString().ToLowerInvariant(), (Format-Duration -Duration $stageWatch.Elapsed))
                $result = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath $tempSql -WorkingDirectory $script:ProjectRoot -XmlDirEnv $segmentDir -ProgressLabel ("DuckDB segment {0}/{1}" -f $segmentIndex, $segmentFiles.Count)

                if ($result.ExitCode -ne 0) {
                    break
                }
            }

            if ($result -and $result.ExitCode -eq 0 -and $null -ne $stepStream) {
                Add-Message "  Loading streamed StepsForScripts tables into DuckDB..."
                $result = Invoke-LoadStreamedSteps -StepStream $stepStream -TempDirectory $tempDir
            }

            if ($result -and $result.ExitCode -eq 0 -and $null -ne $layoutStream) {
                Add-Message "  Loading streamed LayoutCatalog tables into DuckDB..."
                $result = Invoke-LoadStreamedLayouts -LayoutStream $layoutStream -TempDirectory $tempDir
            }
        } else {
            $stageWatch.Restart()
            $tempSql = Join-Path $tempDir "convert.sql"
            Set-ConvertSqlVariables -InputPath $script:SqlTemplate -OutputPath $tempSql -XmlFileName $preprocessedFile -PurgeReferences $true
            $stageWatch.Stop()
            Add-Message ("  Stage SQL template prepared in {0}" -f (Format-Duration -Duration $stageWatch.Elapsed))

            Add-Message "  Converting XML to DuckDB..."
            $result = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath $tempSql -WorkingDirectory $script:ProjectRoot -XmlDirEnv $tempDir -ProgressLabel "DuckDB XML import"
        }

        if ($result.ExitCode -eq 0) {
            $fileTotalWatch.Stop()
            Add-Message ("  File import stages completed in {0}" -f (Format-Duration -Duration $fileTotalWatch.Elapsed))
            return [pscustomobject]@{ Code = 0; Messages = $messages }
        }

        Add-Message "  ERROR: DuckDB conversion failed (exit code: $($result.ExitCode))"
        if (-not [string]::IsNullOrWhiteSpace($result.Output)) {
            Add-Message "  Error details:"
            foreach ($line in ($result.Output -split "`r?`n")) {
                if (-not [string]::IsNullOrWhiteSpace($line)) {
                    Add-Message "    $line"
                }
            }
        }

        return [pscustomobject]@{ Code = 3; Messages = $messages }
    } catch {
        Add-Message "  ERROR: XML preprocessing failed: $($_.Exception.Message)"
        return [pscustomobject]@{ Code = 5; Messages = $messages }
    } finally {
        if ($fileTotalWatch.IsRunning) {
            $fileTotalWatch.Stop()
        }
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Add-ErrorBlock {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [string[]]$Lines = @()
    )

    $safeLines = @($Lines | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($safeLines.Count -eq 0) {
        $safeLines = @("<no output captured>")
    }

    $block = @()
    $block += "================================================================================"
    $block += "ERROR: $Title"
    $block += "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    $block += "================================================================================"
    $block += $safeLines
    $block += ""
    Add-Content -LiteralPath $script:ErrorLogFile -Value $block -Encoding UTF8
}

$rawArgs = @($args)
if ($rawArgs.Count -eq 0) {
    Show-Help
    exit 1
}

$script:Mode = ""
$script:FileName = ""
$script:FailFast = $false
$script:TestMode = $false
$script:ForceRebuild = $false
$script:NoAutoHeal = $false
$script:LargeXmlThresholdBytes = 1GB
$script:LargeSegmentTargetBytes = 32MB
$script:LargeSegmentMaxItems = 5
$script:StreamLargeLayouts = $true
$script:StreamLargeSteps = $true

if (-not [string]::IsNullOrWhiteSpace($env:FM_LAB_XML_SEGMENT_MB)) {
    $targetMb = [int64]0
    if ([int64]::TryParse($env:FM_LAB_XML_SEGMENT_MB, [ref]$targetMb) -and $targetMb -ge 1) {
        $script:LargeSegmentTargetBytes = $targetMb * 1MB
    } else {
        Write-WarnLine "Ignoring FM_LAB_XML_SEGMENT_MB='$env:FM_LAB_XML_SEGMENT_MB'; expected a positive whole-number MB value."
    }
}

if (-not [string]::IsNullOrWhiteSpace($env:FM_LAB_XML_SEGMENT_ITEMS)) {
    $targetItems = [int]0
    if ([int]::TryParse($env:FM_LAB_XML_SEGMENT_ITEMS, [ref]$targetItems) -and $targetItems -ge 1) {
        $script:LargeSegmentMaxItems = $targetItems
    } else {
        Write-WarnLine "Ignoring FM_LAB_XML_SEGMENT_ITEMS='$env:FM_LAB_XML_SEGMENT_ITEMS'; expected a positive whole-number value."
    }
}

if (-not [string]::IsNullOrWhiteSpace($env:FM_LAB_STREAM_LAYOUTS)) {
    if ($env:FM_LAB_STREAM_LAYOUTS -match '^(0|false|no|off)$') {
        $script:StreamLargeLayouts = $false
    } elseif ($env:FM_LAB_STREAM_LAYOUTS -notmatch '^(1|true|yes|on)$') {
        Write-WarnLine "Ignoring FM_LAB_STREAM_LAYOUTS='$env:FM_LAB_STREAM_LAYOUTS'; expected 0/1, true/false, yes/no or on/off."
    }
}

if (-not [string]::IsNullOrWhiteSpace($env:FM_LAB_STREAM_STEPS)) {
    if ($env:FM_LAB_STREAM_STEPS -match '^(0|false|no|off)$') {
        $script:StreamLargeSteps = $false
    } elseif ($env:FM_LAB_STREAM_STEPS -notmatch '^(1|true|yes|on)$') {
        Write-WarnLine "Ignoring FM_LAB_STREAM_STEPS='$env:FM_LAB_STREAM_STEPS'; expected 0/1, true/false, yes/no or on/off."
    }
}

foreach ($arg in $rawArgs) {
    switch -Regex ($arg) {
        '^(--help|-h|/\?)$' {
            Show-Help
            exit 0
        }
        '^(--test|-Test)$' {
            $script:Mode = "batch"
            $script:TestMode = $true
            continue
        }
        '^(--batch|--all|-Batch|-All)$' {
            $script:Mode = "batch"
            continue
        }
        '^(--fail-fast|-FailFast)$' {
            $script:FailFast = $true
            continue
        }
        '^(--force-rebuild|-ForceRebuild)$' {
            $script:ForceRebuild = $true
            continue
        }
        '^(--no-auto-heal|-NoAutoHeal)$' {
            $script:NoAutoHeal = $true
            continue
        }
        default {
            if ($arg.StartsWith("-")) {
                Write-ErrorLine "Unknown flag: $arg"
                Show-Help
                exit 1
            }
            if (-not [string]::IsNullOrWhiteSpace($script:FileName)) {
                Write-ErrorLine "Multiple filenames provided ('$script:FileName', '$arg'). Use --batch to process all files."
                exit 1
            }
            $script:FileName = $arg
            $script:Mode = "single"
        }
    }
}

if ([string]::IsNullOrWhiteSpace($script:Mode)) {
    Write-ErrorLine "No mode or filename provided."
    Show-Help
    exit 1
}

$script:ProjectRoot = Get-ProjectRoot
$script:SqlTemplate = Join-Path $script:ProjectRoot "sql\convert_xml.sql"
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

$script:DuckDbBin = Resolve-DuckDbCli

if ([string]::IsNullOrWhiteSpace($script:DuckDbBin)) {
    Write-ErrorLine "DuckDB CLI not found. Install it from https://duckdb.org/docs/installation/"
    Write-ErrorLine "Or set FM_LAB_DUCKDB_EXE to the full path of duckdb.exe."
    exit 1
}

if ($script:TestMode) {
    $script:XmlDir = Join-Path $script:ProjectRoot "xml-test"
    $script:DbDir = Join-Path $script:ProjectRoot "db"
    $script:DbFile = Join-Path $script:DbDir "fm_test.duckdb"
    $script:LogPrefix = "test_batch_import"
} else {
    $script:XmlDir = Get-DefaultXmlDir
    $script:DbFile = Resolve-ConfiguredPath -ConfiguredPath $env:FM_LAB_DB_FILE -DefaultPath (Join-Path $script:ProjectRoot "db\fm_catalog.duckdb")
    $script:DbDir = Split-Path -Parent $script:DbFile
    $script:LogPrefix = "batch_import"
}

$script:LogDir = Join-Path $script:ProjectRoot "logs"
$script:LogFile = Join-Path $script:LogDir "$($script:LogPrefix)_$timestamp.log"
$script:ErrorLogFile = Join-Path $script:LogDir "$($script:LogPrefix)_${timestamp}_errors.log"
$script:RestApiDbFile = Resolve-ConfiguredPath -ConfiguredPath $env:FM_LAB_REST_API_DB_FILE -DefaultPath (Join-Path $script:ProjectRoot "rest-api\db\fm_catalog.duckdb")
$script:RestApiDbDir = Split-Path -Parent $script:RestApiDbFile
$script:RestApiReloadUrl = if ($env:REST_API_RELOAD_URL) { $env:REST_API_RELOAD_URL } else { "http://localhost:3003/api/admin/reload" }

New-Item -ItemType Directory -Force -Path $script:DbDir, $script:LogDir | Out-Null
if (-not $script:TestMode) {
    New-Item -ItemType Directory -Force -Path $script:XmlDir | Out-Null
}

Compute-SchemaState
$script:SchemaActionExecuted = $script:SchemaAction

Write-Host "========================================="
Write-Host "Schema-Detection"
Write-Host "========================================="
Write-Host "Template Version:  $script:SchemaVersionExpected"
Write-Host "Template Hash:     $($script:SchemaHashExpected.Substring(0, [Math]::Min(12, $script:SchemaHashExpected.Length)))..."
if (-not [string]::IsNullOrWhiteSpace($script:SchemaVersionDb)) {
    Write-Host "DB Version:        $script:SchemaVersionDb"
    Write-Host "DB Hash:           $($script:SchemaHashDb.Substring(0, [Math]::Min(12, $script:SchemaHashDb.Length)))..."
} else {
    Write-Host "DB Version:        <no SchemaInfo / DB does not exist>"
}
Write-Host "Action:            $script:SchemaAction"
Write-Host "Reason:            $script:SchemaReason"

if ($script:ForceRebuild -and (Test-Path -LiteralPath $script:DbFile)) {
    Write-Host ""
    Write-WarnLine "--force-rebuild active: DB will be deleted before import"
    Remove-DbForRebuild -Reason "--force-rebuild explicitly set"
    $script:SchemaActionExecuted = "force_rebuild"
}

if ($script:SchemaAction -eq "rebuild" -and -not $script:ForceRebuild) {
    if ($script:NoAutoHeal) {
        Write-Host ""
        Write-ErrorLine "Schema drift detected and --no-auto-heal is active."
        Write-Host "       $script:SchemaReason"
        Write-Host ""
        Write-Host "       Manual rebuild: powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\convert_fm_xml.ps1 --batch --force-rebuild"
        exit 6
    }

    if ($script:Mode -eq "single") {
        Write-Host ""
        Write-ErrorLine "Schema drift detected. Single-file auto-heal is disabled because it would drop other files from the DB."
        Write-Host "       DB-Version: $($script:SchemaVersionDb)   Template-Version: $script:SchemaVersionExpected"
        Write-Host "       Reason: $script:SchemaReason"
        Write-Host ""
        Write-Host "Recommended: powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\convert_fm_xml.ps1 --batch --force-rebuild"
        exit 6
    }

    Write-Host ""
    Write-WarnLine "Auto-heal: DB will be deleted and rebuilt in batch mode"
    Remove-DbForRebuild -Reason $script:SchemaReason
    $script:SchemaActionExecuted = "auto_heal_rebuild"
}

if ($script:SchemaAction -eq "warn") {
    Write-Host ""
    Write-WarnLine $script:SchemaReason
}

Write-Host ""

if ($script:Mode -eq "batch") {
    Write-Host "========================================="
    if ($script:TestMode) {
        Write-Host "FileMaker XML TEST Import"
        Write-Host "Source: xml-test/ -> db/fm_test.duckdb"
    } else {
        Write-Host "FileMaker XML Batch Import"
        Write-Host "Source: $script:XmlDir"
    }
    if ($script:FailFast) {
        Write-Host "(Fail-Fast Mode: Stop on first error)"
    }
    Write-Host "========================================="

    $xmlFiles = @(Get-ChildItem -LiteralPath $script:XmlDir -Filter "*.xml" -File -ErrorAction SilentlyContinue | Sort-Object Name)
    $total = $xmlFiles.Count
    if ($total -eq 0) {
        Write-ErrorLine "No XML files found in $script:XmlDir"
        exit 1
    }

    Write-Host "Found $total XML files to process"
    Write-Host ""

    $initialLog = @(
        "================================================================================",
        "FileMaker XML Batch Import Log",
        "================================================================================",
        "Start Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
        "Total Files: $total",
        "Schema Version (Template): $script:SchemaVersionExpected",
        "Schema Action: $script:SchemaActionExecuted ($script:SchemaReason)",
        "",
        "--------------------------------------------------------------------------------",
        "Per-File Results:",
        "--------------------------------------------------------------------------------"
    )
    Set-Content -LiteralPath $script:LogFile -Value $initialLog -Encoding UTF8

    $successCount = 0
    $skippedCount = 0
    $failedFiles = New-Object System.Collections.Generic.List[string]
    $skippedFiles = New-Object System.Collections.Generic.List[string]
    $batchWatch = [System.Diagnostics.Stopwatch]::StartNew()

    for ($i = 0; $i -lt $total; $i++) {
        $file = $xmlFiles[$i]
        $basename = $file.Name
        $current = $i + 1
        Write-Host "[$current/$total] Processing: $basename"

        $fileWatch = [System.Diagnostics.Stopwatch]::StartNew()
        $result = Invoke-ProcessSingleFile -FileName $basename
        $fileWatch.Stop()

        if ($result.Code -eq 0) {
            $successCount++
            $fileStatus = "SUCCESS"
            Write-Info "Success"
        } elseif ($result.Code -eq 4) {
            $skippedCount++
            $skippedFiles.Add($basename)
            $fileStatus = "SKIPPED"
            Write-WarnLine "Skipped (unsupported format)"
        } else {
            $failedFiles.Add($basename)
            $fileStatus = "FAILED"
            Write-ErrorLine "Failed"
            Add-ErrorBlock -Title $basename -Lines ([string[]]$result.Messages)

            if ($script:FailFast) {
                Write-Host ""
                Write-Host "========================================="
                Write-Host "FAIL-FAST MODE: Stopping batch import"
                Write-Host "========================================="
                Write-Host "Failed on file: $basename"
                Write-Host "Error log: $script:ErrorLogFile"
                exit 1
            }
        }

        $logLine = "{0:yyyy-MM-dd HH:mm:ss} | {1,-30} | {2,8:N3}s | {3}" -f (Get-Date), $basename, $fileWatch.Elapsed.TotalSeconds, $fileStatus
        Add-Content -LiteralPath $script:LogFile -Value $logLine -Encoding UTF8
        Write-Host ""
    }

    Write-Host "========================================="
    Write-Host "Building universal catalogs..."
    Write-Host "========================================="
    $catalogResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\create_universal_catalogs.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB universal catalogs"
    if ($catalogResult.ExitCode -eq 0) {
        Write-Info "Universal catalogs created successfully"
    } else {
        Write-WarnLine "Universal catalogs failed"
        Add-ErrorBlock -Title "Universal Catalogs Creation" -Lines ($catalogResult.Output -split "`r?`n")
        if ($script:FailFast) {
            Write-Host "Error log: $script:ErrorLogFile"
            exit 1
        }
    }
    Write-Host ""

    Write-Host "========================================="
    Write-Host "Building table occurrence usage analysis..."
    Write-Host "========================================="
    $toUsageResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\create_table_occurrence_usage_analysis.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB TO usage analysis"
    if ($toUsageResult.ExitCode -eq 0) {
        Write-Info "Table occurrence usage analysis built successfully"
    } else {
        Write-WarnLine "Table occurrence usage analysis failed"
        Add-ErrorBlock -Title "Table Occurrence Usage Analysis" -Lines ($toUsageResult.Output -split "`r?`n")
        if ($script:FailFast) {
            Write-Host "Error log: $script:ErrorLogFile"
            exit 1
        }
    }
    Write-Host ""

    Write-Host "========================================="
    Write-Host "Building object usage analysis..."
    Write-Host "========================================="
    $objectUsageResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\create_object_usage_analysis.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB object usage analysis"
    if ($objectUsageResult.ExitCode -eq 0) {
        Write-Info "Object usage analysis built successfully"
    } else {
        Write-WarnLine "Object usage analysis failed"
        Add-ErrorBlock -Title "Object Usage Analysis" -Lines ($objectUsageResult.Output -split "`r?`n")
        if ($script:FailFast) {
            Write-Host "Error log: $script:ErrorLogFile"
            exit 1
        }
    }
    Write-Host ""

    Write-Host "========================================="
    Write-Host "Building credential analysis..."
    Write-Host "========================================="
    $credentialResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\create_credential_analysis.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB credential analysis"
    if ($credentialResult.ExitCode -eq 0) {
        Write-Info "Credential analysis built successfully"
    } else {
        Write-WarnLine "Credential analysis failed"
        Add-ErrorBlock -Title "Credential Analysis" -Lines ($credentialResult.Output -split "`r?`n")
        if ($script:FailFast) {
            Write-Host "Error log: $script:ErrorLogFile"
            exit 1
        }
    }
    Write-Host ""

    Write-Host "========================================="
    Write-Host "Building API integration analysis..."
    Write-Host "========================================="
    $apiIntegrationResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\create_api_integration_analysis.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB API integration analysis"
    if ($apiIntegrationResult.ExitCode -eq 0) {
        Write-Info "API integration analysis built successfully"
    } else {
        Write-WarnLine "API integration analysis failed"
        Add-ErrorBlock -Title "API Integration Analysis" -Lines ($apiIntegrationResult.Output -split "`r?`n")
        if ($script:FailFast) {
            Write-Host "Error log: $script:ErrorLogFile"
            exit 1
        }
    }
    Write-Host ""

    Write-Host "========================================="
    Write-Host "Building layout object quality analysis..."
    Write-Host "========================================="
    $layoutQualityResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\create_layout_object_quality_analysis.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB layout object quality analysis"
    if ($layoutQualityResult.ExitCode -eq 0) {
        Write-Info "Layout object quality analysis built successfully"
    } else {
        Write-WarnLine "Layout object quality analysis failed"
        Add-ErrorBlock -Title "Layout Object Quality Analysis" -Lines ($layoutQualityResult.Output -split "`r?`n")
        if ($script:FailFast) {
            Write-Host "Error log: $script:ErrorLogFile"
            exit 1
        }
    }
    Write-Host ""

    Write-Host "========================================="
    Write-Host "Building quality and risk analysis..."
    Write-Host "========================================="
    $qualityResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\create_quality_analysis.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB quality analysis"
    if ($qualityResult.ExitCode -eq 0) {
        Write-Info "Quality and risk analysis built successfully"
    } else {
        Write-WarnLine "Quality and risk analysis failed"
        Add-ErrorBlock -Title "Quality and Risk Analysis" -Lines ($qualityResult.Output -split "`r?`n")
        if ($script:FailFast) {
            Write-Host "Error log: $script:ErrorLogFile"
            exit 1
        }
    }
    Write-Host ""

    Write-Host "========================================="
    Write-Host "Building localization labels..."
    Write-Host "========================================="
    $localizationResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\create_localization_labels.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB localization labels"
    if ($localizationResult.ExitCode -eq 0) {
        Write-Info "Localization labels built successfully"
    } else {
        Write-WarnLine "Localization labels failed"
        Add-ErrorBlock -Title "Localization Labels" -Lines ($localizationResult.Output -split "`r?`n")
        if ($script:FailFast) {
            Write-Host "Error log: $script:ErrorLogFile"
            exit 1
        }
    }
    Write-Host ""

    Write-Host "========================================="
    Write-Host "Building resolution tables..."
    Write-Host "========================================="
    $resolutionResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\build_resolutions.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB resolution tables"
    if ($resolutionResult.ExitCode -eq 0) {
        Write-Info "Resolution tables built successfully"
    } else {
        Write-WarnLine "Resolution tables failed"
        Add-ErrorBlock -Title "Resolution Tables Creation" -Lines ($resolutionResult.Output -split "`r?`n")
        if ($script:FailFast) {
            Write-Host "Error log: $script:ErrorLogFile"
            exit 1
        }
    }
    Write-Host ""

    if (-not $script:TestMode -and $failedFiles.Count -eq 0) {
        Write-Host "========================================="
        Write-Host "Syncing database to rest-api/..."
        Write-Host "========================================="
        Invoke-SyncToRestApi
        Write-Host ""
    }

    $batchWatch.Stop()
    $minutes = [Math]::Floor($batchWatch.Elapsed.TotalMinutes)
    $seconds = $batchWatch.Elapsed.TotalSeconds - ($minutes * 60)

    Write-Host "========================================="
    Write-Host "Batch Import Complete"
    Write-Host "========================================="
    Write-Host "Total files: $total"
    Write-Host "Successful: $successCount"
    Write-Host "Skipped: $skippedCount"
    Write-Host "Failed: $($failedFiles.Count)"
    Write-Host ("Total duration: {0}m {1:N3}s ({2:N3} seconds)" -f $minutes, $seconds, $batchWatch.Elapsed.TotalSeconds)

    $summary = @(
        "",
        "--------------------------------------------------------------------------------",
        "Summary:",
        "--------------------------------------------------------------------------------",
        "End Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
        "Total Duration: ${minutes}m ${seconds}s ($($batchWatch.Elapsed.TotalSeconds) seconds)",
        "Total Files: $total",
        "Successful: $successCount",
        "Skipped: $skippedCount",
        "Failed: $($failedFiles.Count)"
    )
    Add-Content -LiteralPath $script:LogFile -Value $summary -Encoding UTF8

    if ($skippedCount -gt 0) {
        Write-Host ""
        Write-Host "Skipped files (unsupported format):"
        foreach ($skipped in $skippedFiles) {
            Write-Host "  - $skipped"
        }
        Add-Content -LiteralPath $script:LogFile -Value @("", "Skipped Files (unsupported format):") -Encoding UTF8
        foreach ($skipped in $skippedFiles) {
            Add-Content -LiteralPath $script:LogFile -Value "  - $skipped" -Encoding UTF8
        }
    }

    if ($failedFiles.Count -gt 0) {
        Write-Host ""
        Write-Host "Failed files:"
        foreach ($failed in $failedFiles) {
            Write-Host "  - $failed"
        }
        Add-Content -LiteralPath $script:LogFile -Value @("", "Failed Files:") -Encoding UTF8
        foreach ($failed in $failedFiles) {
            Add-Content -LiteralPath $script:LogFile -Value "  - $failed" -Encoding UTF8
        }
    }

    Add-Content -LiteralPath $script:LogFile -Value "================================================================================" -Encoding UTF8

    Write-Host ""
    Write-Host "Log file: $script:LogFile"
    if ($failedFiles.Count -gt 0 -and (Test-Path -LiteralPath $script:ErrorLogFile)) {
        Write-Host "Error details: $script:ErrorLogFile"
        exit 1
    }

    exit 0
}

if ($script:Mode -eq "single") {
    $singleResult = Invoke-ProcessSingleFile -FileName $script:FileName
    if ($singleResult.Code -eq 0) {
        Write-Host "SUCCESS: Database created successfully from $script:FileName"

        Write-Host ""
        Write-Host "Building universal catalogs..."
        $catalogResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\create_universal_catalogs.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB universal catalogs"
        if ($catalogResult.ExitCode -eq 0) {
            Write-Info "Universal catalogs built"
        } else {
            Write-WarnLine "Universal catalogs failed"
        }

        Write-Host ""
        Write-Host "Building resolution tables..."
        $resolutionResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\build_resolutions.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB resolution tables"
        if ($resolutionResult.ExitCode -eq 0) {
            Write-Info "Resolution tables built"
        } else {
            Write-WarnLine "Resolution tables failed (run universal catalogs first?)"
        }

        Write-Host ""
        Write-Host "Building table occurrence usage analysis..."
        $toUsageResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\create_table_occurrence_usage_analysis.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB TO usage analysis"
        if ($toUsageResult.ExitCode -eq 0) {
            Write-Info "Table occurrence usage analysis built"
        } else {
            Write-WarnLine "Table occurrence usage analysis failed"
        }

        Write-Host ""
        Write-Host "Building object usage analysis..."
        $objectUsageResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\create_object_usage_analysis.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB object usage analysis"
        if ($objectUsageResult.ExitCode -eq 0) {
            Write-Info "Object usage analysis built"
        } else {
            Write-WarnLine "Object usage analysis failed"
        }

        Write-Host ""
        Write-Host "Building credential analysis..."
        $credentialResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\create_credential_analysis.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB credential analysis"
        if ($credentialResult.ExitCode -eq 0) {
            Write-Info "Credential analysis built"
        } else {
            Write-WarnLine "Credential analysis failed"
        }

        Write-Host ""
        Write-Host "Building API integration analysis..."
        $apiIntegrationResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\create_api_integration_analysis.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB API integration analysis"
        if ($apiIntegrationResult.ExitCode -eq 0) {
            Write-Info "API integration analysis built"
        } else {
            Write-WarnLine "API integration analysis failed"
        }

        Write-Host ""
        Write-Host "Building layout object quality analysis..."
        $layoutQualityResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\create_layout_object_quality_analysis.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB layout object quality analysis"
        if ($layoutQualityResult.ExitCode -eq 0) {
            Write-Info "Layout object quality analysis built"
        } else {
            Write-WarnLine "Layout object quality analysis failed"
        }

        Write-Host ""
        Write-Host "Building quality and risk analysis..."
        $qualityResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\create_quality_analysis.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB quality analysis"
        if ($qualityResult.ExitCode -eq 0) {
            Write-Info "Quality and risk analysis built"
        } else {
            Write-WarnLine "Quality and risk analysis failed"
        }

        Write-Host ""
        Write-Host "Building localization labels..."
        $localizationResult = Invoke-DuckDbSqlFile -DatabasePath $script:DbFile -SqlFilePath (Join-Path $script:ProjectRoot "sql\create_localization_labels.sql") -WorkingDirectory $script:ProjectRoot -ProgressLabel "DuckDB localization labels"
        if ($localizationResult.ExitCode -eq 0) {
            Write-Info "Localization labels built"
        } else {
            Write-WarnLine "Localization labels failed"
        }

        if (-not $script:TestMode) {
            Write-Host ""
            Write-Host "Syncing database to rest-api/..."
            Invoke-SyncToRestApi
        }

        exit 0
    }

    exit $singleResult.Code
}
