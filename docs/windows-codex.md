# Windows/Codex Setup

This fork is named `fm-lab-windows-codex`. It keeps the original fm-lab
architecture but adds a Windows-first workflow for Codex. The
Node/Express/React/DuckDB parts are already portable; the main changes are
PowerShell orchestration scripts and Codex project instructions.

## Requirements

- Windows 10/11
- PowerShell 5.1+ or PowerShell 7+
- Node.js LTS and npm
- DuckDB CLI 1.0+
- FileMaker Pro 19+ for `Save a Copy As XML`

Links:

- DuckDB CLI: https://duckdb.org/docs/installation/
- Node.js: https://nodejs.org/
- PowerShell: https://learn.microsoft.com/powershell/
- FileMaker XML export script step: https://help.claris.com/en/pro-help/content/save-a-copy-as-xml.html

The root start script checks `PATH` first and then common per-user and Program
Files locations. If Node.js or DuckDB is missing, it offers a `winget`
installation where available and otherwise prints the manual installation hint.

Install hints:

```powershell
winget install OpenJS.NodeJS.LTS
winget install --id DuckDB.cli --exact --source winget
scoop install duckdb
choco install duckdb
```

No Python packages are needed for the standard import and server workflow.

## First Setup

From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-FileMaker-Object-Browser.ps1
```

For double-click use on Windows, start `Start-FileMaker-Object-Browser.cmd`.

This is the recommended one-file Windows start after cloning the repository.
The script checks Node.js/npm, runs `npm install` if dependencies are missing,
builds the shared package when required, asks which XML file should be imported,
offers the bundled Kontakte XML when `xml/` is empty, finds or installs
DuckDB, starts the REST API plus frontend, and opens the web client. If a local
REST API is already running, the script can restart it so the selected DuckDB
database is actually used by the website.

Useful variants:

```powershell
.\Start-FileMaker-Object-Browser.ps1 --xml Kontakte.xml --start-website --codex
.\Start-FileMaker-Object-Browser.ps1 --skip-import --start-website --claude
.\Start-FileMaker-Object-Browser.ps1 --skip-import --no-start-website
```

## XML Import

The repository ships with a small neutral `xml/Kontakte.xml` example so a fresh
clone can be started immediately. To analyze your own FileMaker file, place the
exported XML in `xml/`, or point the importer to an external local data folder:

```powershell
$env:FM_LAB_XML_DIR = "C:\Path\To\FileMakerXml"
```

Then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\convert_fm_xml.ps1 --batch
```

Force a clean rebuild:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\convert_fm_xml.ps1 --batch --force-rebuild
```

Single-file import:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\convert_fm_xml.ps1 "MyDatabase.xml"
```

The converter accepts UTF-16 and UTF-8-compatible exports. Before DuckDB reads
the XML, it replaces carriage returns with `0x7F` and strips invalid XML 1.0
C0 control bytes, matching the behavior of the original Bash script.

XML files larger than 1 GB are not imported as one monolithic DuckDB XML read.
The Windows converter first streams `LayoutCatalog` and `StepsForScripts` with
.NET `XmlReader` into CSV staging files and loads the resulting layout, script
step, XML reference, and calculation-hash staging tables into DuckDB. This
avoids the high-memory DuckDB XPath path for very large layouts and the slow
XPath path for large script-step catalogs. The remaining XML is split into
temporary catalog segments. If an individual
catalog segment is still large, it is split again into `part001`, `part002`, and
following files with a 32 MB target size. This keeps large library and script
catalogs importable without changing the final DuckDB catalog structure.
Set `FM_LAB_XML_SEGMENT_MB` to a positive whole-number MB value if a specific
machine needs larger or smaller blocks. For `LayoutCatalog`, the split also
caps each part at 5 direct layout entries by default; override this with
`FM_LAB_XML_SEGMENT_ITEMS` when a FileMaker export needs finer or coarser layout
batches. For diagnostics only, set `FM_LAB_STREAM_LAYOUTS=0` or
`FM_LAB_STREAM_STEPS=0` to disable the streaming extractors.

After the raw XML and universal catalogs are loaded, the converter builds the
precomputed table occurrence usage analysis from
`sql/create_table_occurrence_usage_analysis.sql`. It creates:

- `TableOccurrenceUsageSummary`
- `TableOccurrenceUsageDetails`
- `TableOccurrenceRelationshipDetails`

These tables power the web client's `TO-Nutzung` view and the REST endpoint
`/api/analysis/table-occurrences/usage`. They avoid slow live scans over field
calculations, auto-enter calculations, custom functions, layout formulas,
script references, and relationships.

The converter also builds `ObjectUsageSummary` and `ObjectUsageDetails` from
`sql/create_object_usage_analysis.sql`. These tables power the `Objekt-Nutzung`
view and `/api/analysis/objects/usage` for unused or rarely referenced scripts,
layouts, custom functions, value lists, fields, and base tables. Structural
containment links are excluded there, so a script is not considered used merely
because it contains script steps.

The repository folder `xml/` contains only the neutral `Kontakte.xml` example
for first-run onboarding. Productive exports should usually stay outside Git in
an external local data folder. For special cases, override the input path:

```powershell
$env:FM_LAB_XML_DIR = "C:\Path\To\FileMakerXml"
```

The optional FileMaker reference database can be placed locally at
`rest-api/db/fm_reference.duckdb`. It is intentionally ignored for GitHub
uploads because it is generated runtime data. The main importer and web client
work without it; only the `/api/reference` endpoints are unavailable until that
local file exists.

## Start and Stop

Start:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-FileMaker-Object-Browser.ps1
```

Stop:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\stop-servers.ps1
```

URLs:

```text
REST API:  http://localhost:3003
Frontend:  http://localhost:5173
```

Logs:

```text
logs/rest-api.out.log
logs/rest-api.err.log
logs/frontend.out.log
logs/frontend.err.log
```

## npm Wrappers

The same workflow is available through npm:

```powershell
npm run init:win
npm run convert:win -- --batch
npm run convert:win -- --batch --force-rebuild
npm run start:win
npm run stop:win
```

For direct development without background processes:

```powershell
npm run dev:all
```

## Quality Gates

Run these checks before handing a change over:

```powershell
npm run lint
npm run test
npm run build:shared
npm run build --workspace=web
npm audit --omit=dev --audit-level=high
npm run test:xml
```

`npm run test` runs real suites in the REST API and web workspaces. The REST API
suite covers root, version, info, object search, script search, analysis
endpoint wiring, validation errors, and query normalizer logging. The web suite
currently covers the plugin HTML sanitizer with malicious and allowed payloads.

`npm run test:xml` imports the small fixture in `xml-test/` into
`db/fm_test.duckdb`. It is a structural smoke test for the Windows XML
converter and does not use productive FileMaker exports.

## Debug And Logs

Debug output is opt-in. In normal operation the API does not include debug SQL
in JSON, Markdown, HTML, or text responses.

```text
LOG_LEVEL=info
LOG_FORMAT=text
ALLOW_DEBUG_OUTPUT=0
DEBUG_QUERY_NORMALIZER=0
```

Set `ALLOW_DEBUG_OUTPUT=1` only in non-production environments when SQL/debug
comments are intentionally needed. `DEBUG_QUERY_NORMALIZER=1` enables verbose
query-key normalization logs when `LOG_LEVEL=debug` is also set. It should stay
disabled in normal use.

`LOG_FORMAT=json` emits structured one-line JSON logs for process, database,
plugin, warning, and error messages. HTTP access logs are still written to
`LOG_FILE`; development console access logs are routed through the same
application logger.

## Web Client Structure

The web entrypoint `apps/web/src/App.tsx` is intentionally kept as a small
router shell. The main dashboard/search workflow lives in
`apps/web/src/views/SearchView.tsx`, heavy route targets are loaded lazily, and
shared UI language helpers live in `apps/web/src/lib/uiLanguage.ts`.

The Vite build uses `manualChunks` to keep Cytoscape and related graph-heavy
dependencies in `vendor-graph`. This protects the startup path for the normal
dashboard/search workflow; graph-heavy views load that chunk only when opened.

Plugin documentation HTML is rendered through a whitelist sanitizer in
`apps/web/src/script/sanitize.ts`. Allowed tags and attributes are intentionally
narrow; executable tags, event handlers, and unsafe URLs are stripped or
removed.

## AI Chat Retention

AI conversations are stored as JSON files outside the read-only DuckDB catalog.
Retention and size limits are controlled through:

```text
AI_CHAT_RETENTION_DAYS=30
AI_CHAT_MAX_CONVERSATIONS=200
AI_CHAT_MAX_MESSAGES=60
AI_CHAT_MAX_FILE_BYTES=1048576
```

The API trims oversized conversations and periodically removes old, oversized,
or excess conversation files.

## Data Paths

Master database:

```text
db/fm_catalog.duckdb
```

REST API read copy:

```text
rest-api/db/fm_catalog.duckdb
```

Codex and ad-hoc analysis should read from the master database. The REST API
copy is only the runtime copy for the server and can be temporarily stale.

## Codex Context

Use:

```text
AGENTS.md
README.md
docs/windows-codex.md
```

Keep `CLAUDE.md` and `.claude/skills/` as upstream/legacy references unless a
task explicitly asks to migrate a Claude skill.

## Help

Every Windows script has a help path:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\init.ps1 --help
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\convert_fm_xml.ps1 --help
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-servers.ps1 --help
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\stop-servers.ps1 --help
```
