#Requires -Version 5.1
<#
.SYNOPSIS
Starts the FileMaker Object Browser for this Windows/Codex fork.

.DESCRIPTION
This root-level helper is the friendly entry point for local users. It forwards
all arguments to tools/start-servers.ps1 and keeps the working directory at the
project root.

Examples:
  .\Start-FileMaker-Object-Browser.ps1
  .\Start-FileMaker-Object-Browser.ps1 --xml Kontakte.xml --start-website --codex
  .\Start-FileMaker-Object-Browser.ps1 --skip-import --start-website --claude
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$startScript = Join-Path $projectRoot "tools\start-servers.ps1"

if (-not (Test-Path -LiteralPath $startScript)) {
    Write-Host "[ERROR] Start script not found: $startScript"
    exit 1
}

Set-Location -LiteralPath $projectRoot
& $startScript @args
exit $LASTEXITCODE
