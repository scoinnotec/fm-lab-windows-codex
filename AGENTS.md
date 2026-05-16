# fm-lab-windows-codex Codex/Windows Instructions

## Project Role

This repository is `fm-lab-windows-codex`, a Windows/Codex fork of
fm-lab and a DuckDB-based analysis foundation for FileMaker Save-as-XML
exports.

The main goal is to make FileMaker structure queryable for humans and AI
agents without relying on Claude Code or macOS-only shell tooling.

## Preferred Windows Commands

Use the PowerShell scripts under `tools/` on Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\init.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\convert_fm_xml.ps1 --batch
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-servers.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\stop-servers.ps1
```

Equivalent npm wrappers are available:

```powershell
npm run init:win
npm run convert:win -- --batch
npm run start:win
npm run stop:win
```

The legacy Bash scripts remain available for macOS/Linux compatibility, but
Windows work should not depend on `bash`, `lsof`, `nohup`, `file`, `iconv`,
`tr`, `sed`, `md5sum`, Homebrew paths, or `.claude/settings.json`.

## External Tools

Required:

- DuckDB CLI: https://duckdb.org/docs/installation/
- Node.js LTS / npm: https://nodejs.org/
- PowerShell 5.1+ or PowerShell 7+: https://learn.microsoft.com/powershell/

The Windows scripts check `PATH` first and then common per-user and Program
Files locations when `duckdb` is not on `PATH`.

Windows install hints:

```powershell
winget install OpenJS.NodeJS.LTS
winget search DuckDB
scoop install duckdb
choco install duckdb
```

No Python package is required for the normal fm-lab-windows-codex
import/start workflow.

## Data Flow

FileMaker XML exports are read from `xml/` by default. For large or productive
exports, set `FM_LAB_XML_DIR` to an external local data folder so XML files stay
out of Git.

The repository folder `xml/` contains the neutral `Kontakte.xml` onboarding
example and should not contain productive exports.

Override for special cases:

```powershell
$env:FM_LAB_XML_DIR = "C:\Path\To\FileMakerXml"
```

The canonical analysis database is:

```text
db/fm_catalog.duckdb
```

The REST API reads a separate copy:

```text
rest-api/db/fm_catalog.duckdb
```

Codex and ad-hoc DuckDB analysis should prefer the master DB in `db/`.
The REST API copy can be stale briefly between conversion and reload.

## FileMaker XML Support

Supported:

- SaXML v2.1.0.0+ with root element `FMSaveAsXML`
- FileMaker 19+ exports
- Exports created with "Include details for analysis tools" enabled

Unsupported:

- Legacy SaXML v2.0.0.0 with root element `FMDynamicTemplate`

## Codex Working Rules

- Prefer `AGENTS.md`, `README.md`, and `docs/windows-codex.md` as the active
  onboarding context for Codex.
- Keep `CLAUDE.md` and `.claude/skills/` as upstream/legacy references unless
  the task explicitly asks to migrate a Claude skill.
- Do not invent FileMaker functions, script steps, triggers, or error codes.
- For Windows script changes, keep a `--help` path and document external tools.
- For HTML/CSS changes, avoid gradients unless explicitly requested.
- Preserve the database split between `db/fm_catalog.duckdb` and
  `rest-api/db/fm_catalog.duckdb`.

## Useful Checks

```powershell
npm run build:shared
npm run lint --workspaces --if-present
npm run test --workspaces --if-present
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\convert_fm_xml.ps1 --help
```
