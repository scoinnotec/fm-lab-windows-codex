# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/).

---

## [Unreleased]

*(Upcoming changes go here)*

---

## [0.6.7] — 2026-05-13

Central reference database, pseudo object types, token-based code rendering, cross-reference highlight, and full dark mode.

- **Central reference database** from `fm-spec`: localized Claris Help cache (English + German) served via a dedicated REST endpoint with language selector — ScriptStep and function reference info available inline in the frontend
- New **`install-claris-docs`** skill: crawls and installs Claris Help locally in one or multiple languages
- **MBS plugin help** served locally alongside Claris Help
- **Pseudo object types** in `ObjectCatalog`: `ScriptStep`, `Function`, `MBS-Component`, and `MBS-Function` registered as first-class catalog entries with type-specific detail templates — searchable and filterable like any other object
- **Token-based code rendering** across all formula contexts:
  - Scripts: token endpoint replaces plain step text — refs, hover popovers, code folding, code filter, inspections popover, viewer header
  - Custom Functions: dedicated `CustomFunctionViewer` with the same token model
  - Calculated / AutoEnter fields: rendered via `CalcTokenSpan` / `FieldViewer` with full token interactivity
- **Cross-reference highlight ("Ref-Mode")**: highlights every occurrence of a referenced object across script bodies, calculations, and reference panels; new back-references API drives navigation
- **Universal function links** in `convert_xml.sql`: built-in functions, plugin functions, and `Get(...)` sub-parameters registered as `ObjectLinks` in correct chunk order — enables exhaustive call-chain queries
- **Field references for every ScriptStep variant**: the parser now resolves field refs across all script-step shapes, not just the canonical ones — eliminates blind spots in dependency queries
- **Pseudo-token filter toolbar** in the references panel with type-aware filtering and search
- **Full dark mode**: `ThemeToggle`, persistent theme preference, themed layout-object and relationship-graph palettes, dark mode extended to Claris/MBS help panels

---

## [0.6.6] — 2026-05-09

Interactive layout view, layout object Z-order in the parser, and rich frontend navigation.

- **Interactive layout view**: new `LayoutCanvas` / `LayoutObjectShape` / `LayoutObjectTooltip` components — visual rendering of layout objects with hover tooltips, type filter (`LayoutTypeFilter`), free-text search, and cross-navigation to fields, scripts, and value lists
- **Layout object Z-order** in `convert_xml.sql`: parser now preserves the stacking order from the XML so the canvas renders objects respecting the original front-to-back hierarchy
- New SQL templates `display_layout_objects_data.sql` and `display_layout_parts_data.sql` powering the layout view; `display_layout_svg.sql` adapted to the new ordering
- **References filter & search** in the detail view: `ReferencesFilter` component to narrow down referenced/referencing objects by type and free-text query
- **Keyboard navigation**: cursor navigation through reference lists and a `useEscapeStack` hook for `ESC` → back navigation across nested views
- **URL-persistent page state**: `useUrlState` hook synchronizes active view, selection, filter, and search into URL parameters — deep-linkable and survives reload

---

## [0.6.5] — 2026-05-08

Relationship graph visualization, extended TableOccurrence schema, enriched script-reference tokens, and plugin documentation API.

- **Extended TableOccurrence data model**: parser now resolves the underlying `BaseTable` reference for every `TableOccurrence` and tracks the home file of each field (relevant for cross-file relationships) — surfaces in `convert_xml.sql` and propagates through `ObjectCatalog` / `ObjectLinks`
- **Schema additions** for graph-aware queries: TO rows carry their resolved base table, fields carry their home file, and relationships expose left/right TO + field metadata in the new graph SQL templates
- **Relationship graph view**: interactive visualization of `TableOccurrences`, fields, and relationships — TO boxes, join lines, automatic graph layout, search field with result selection, and cross-navigation / deep-linking between objects
- Dedicated REST API endpoints for the graph (`relationship_graph_tos.sql`, `relationship_graph_relationships.sql`, `relationship_graph_fields.sql`) with a `relationshipGraph` controller and route
- Web frontend components `RelationshipGraph` / `TOBox` / `JoinLine` and `useGraphSearch` / `useRelationshipGraph` hooks
- **Plugin function documentation API**: new `/plugin-docs` endpoint with HTML extractor and marker-based section parsing for inline help on plugin / MBS function calls
- MBS source service and `plugin-token-registry` for resolving and annotating plugin function references in the token formatter
- **Enriched token output** in `object_references_script.sql`: TableOccurrence info on field references, GTRR (Go to Related Record) target resolution, DDR-calculation token-refs, and additional reference metadata for script steps
- New `build_resolutions.sql` for cross-reference resolution preprocessing

---

## [0.6.4] — 2026-05-07

XML import preprocessor: preserves line breaks in calculation code and tolerates invalid XML control characters.

- Preprocessor integrated directly into `convert_fm_xml.sh`
- Line-break preservation via sentinel `U+2028`: bypasses the `webbed` extension's whitespace collapse (`CleanTextContent`) so original CR/LF in CDATA payloads (Custom Functions, Calculated Fields, AutoEnter calcs, Script steps, Layout-Object formulas) survives the parse — sentinel is replaced back to LF inside `convert_xml.sql`
- Stripping of XML 1.0 invalid C0 control characters (e.g. `Char(3)` embedded in FileMaker scripts) — adresses the `Invalid Input Error: contains invalid XML` abort
- Upstream issue draft prepared for the `duckdb_webbed` maintainer — feature request for option to preserve internal whitespace
- REST-API fix for DB close

---

## [0.6.3] — 2026-05-06

Extended object reference parser: complete coverage of read/write accesses across calculations and plugin calls.

- **Read accesses to fields** in addition to write accesses — full coverage of field references inside any calculation context
- **Layout-object calculations** parsed as references: conditional formatting, hide formula, tooltip, placeholder, and visibility expressions now produce `displays_field` / `reads_variable` / `triggers_script` links
- **CustomFunction call chains**: cross-references between calculations resolved via DDR chunks
- **Plugin function calls** (e.g. MBS Plugin) registered as object references in `ObjectCatalog` / `ObjectLinks`
- **Field → Layout** references for direct on-layout visibility analysis
- Improved layout-box label resolution

---

## [0.6.2] — 2026-05-03

Folder hierarchies as a first-class object type in the catalog.

- New `Folder` object type in `ObjectCatalog`; folders for Scripts, Layouts, and CustomFunctions are registered alongside their leaf objects
- Hierarchical parent/child relationships modeled in `ObjectLinks`
- Dedicated REST API endpoint for folder structures, including type-specific validator and controller
- Detail SQL template `object_details_folder.sql` for the folder view
- New `list_with_folders.sql` custom template
- Web frontend tree view (`FolderTree` / `TreeView` components): browseable folder hierarchy with collapsible nodes
- follow-up optimizations and bugfixes on the folder-based navigation

---

## [0.6.1] — 2026-04-29

Service release: Bugfixes and optimizations.

- Changed npm binding from old 'DuckDB native C++' to new 'DuckDB node-api' interface to prevent installation issues
- Optimizations in init.sh script (verbose mode for npm, Claude settings)
- Optimizations in convert_fm_xml.sh (printf Locale-Fix)
- Changed path references relative to project root
- More robust detection of path to DuckDB CLI and Node cli
- Optimizations in gitignore to prevent conflicts when updating repo from origin

---

## [0.6.0] — 2026-04-22

fmIDE Plugin System: extensible architecture for the REST API and web frontend.

- Plugin interface for registering custom API endpoints and frontend components
- `fmIDE` plugin: opens FileMaker objects directly from the browser via fmIDE
- Settings plugin for persistent per-user configuration
- Plugin code isolated from the main codebase into dedicated module directories
- `install-fmide-docs` skill for local fmIDE documentation
- Consolidated directory structure for `tools/` and `scripts/`

---

## [0.5.0] — 2026-04-17

Public release preparation, AI analysis skills, and dual-database architecture.

- **`fm-summarize`** / **`fm-analyze`** skills: AI-generated technical summaries and semantic analyses of FileMaker objects; `--short` mode for compact output
- **Dual-DB architecture**: master database (`db/fm_catalog.duckdb`) for write access; read-only copy (`rest-api/db/`) for the API server — eliminates file-lock conflicts during parallel import
- Atomic sync mechanism: after each import the copy is updated and the server is hot-reloaded via `POST /api/admin/reload` without a full restart
- Shell scripts `rest-api-start` / `rest-api-stop` / `rest-frontend-start` / `rest-frontend-stop`
- Publish script for preparing the public release
- Project renamed to **fm-lab**

---

## [0.4.0] — 2026-03-27

XML import improvements: robust parsing, AutoEnter fields, and full variable tracking.

- Parser for `AutoEnter` fields: lookup details (source field, relationship TO), calculated auto-enter values, and constant defaults
- Robust JSON parser for special character escaping, integrated directly into SQL (no external Python step)
- Parser for `Calculation_Text` extracted from CDATA sections
- Automatic skipping of outdated SaXML v2.0 format (FileMaker 18.x) with a warning
- **`VariableUsages` / `VariablesCatalog`**: full variable parser detecting local, global, and MBS superglobal variables from script steps, DDR chunks, auto-enter formulas, and layout merge variables
- `install-ooe-fm` and `install-fm-xml-export-exploder` skills for reference data setup
- `duckdb-skills:duckdb-docs` skill for in-terminal DuckDB documentation lookup

---

## [0.3.0] — 2026-02-12

Browser-based web frontend for interactive exploration of the FileMaker analysis.

- Search across all object types with filters by file and type, sorting, and grouping
- Infinite / virtual scrolling for large result sets (chunk-based), search-as-you-type
- Detail view for all object types with 5-tab sub-navigation
- Graph view for object relationships (Mermaid-based)
- Layout SVG preview: visual representation of layout object structures
- REST API `/api/get-details` endpoint with type-specific SQL templates for all object types
- Vite-based dev server; shared `packages/shared` library between frontend and API (npm workspaces monorepo)
- OpenAPI specification as single source of truth; TypeScript types auto-generated

---

## [0.2.0] — 2026-01-26

Multi-file support, universal object catalogs, and REST API.

- **Multi-file support**: all tables extended with a `File_Name` column; multiple XML files importable into one shared database
- **`ObjectCatalog`**: central registry for all 25+ object types across all imported files
- **`ObjectLinks`**: 31 implemented link types (operational dependencies + structural container hierarchies), including cross-file links
- **`FilesCatalog`**: metadata for all imported FileMaker files
- **DDR-Info support** (FileMaker 21+): optional `DDR_ScriptSteps` and `DDR_Calculations` tables; `DDR_Hash` as a JOIN key to calculated fields and custom functions
- REST API (Express.js): `/api/search`, `/api/search/count`, `/api/count`, `/api/info`, `/api/query`
- SQL template system with `getvariable('param')` interpolation; separate folders for report and custom templates
- Case-insensitive search and parameter handling
- `filemaker-script-erzeugen` skill: creates FileMaker scripts in `fmxmlsnippet` format with automatic backup management
- `install-mbs-docs` / `install-filemaker-docs` skills for local documentation setup
- Batch import with fail-fast flag, timing output, and extended error logging

---

## [0.1.0] — 2026-01-13

Initial release: XML conversion pipeline, core database structure, and first AI skills.

- Conversion script `convert_xml.sql` covering all major FileMaker object types: base tables, fields, scripts, script steps, layouts, layout objects (22 types, 4 nesting levels), value lists, accounts, relationships, and more — 30 tables total
- `XMLMetadata` table with FileMaker version and DDR-Info status
- Sample queries (`sql/sample_queries.sql`) as an entry point for ad-hoc analysis
- **`convert-xml`** skill: converts one or all XML files (`--batch`) and manages the import lifecycle
- **`mbs-function-reference`** skill: looks up MBS Plugin functions in a local documentation database
- **`skill-creator`** skill: guided workflow for creating new Claude Code skills

---

<!-- Link references — activate once the first tag exists in this repository:
[Unreleased]: https://github.com/marcelmore/fm-lab/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/marcelmore/fm-lab/releases/tag/v0.6.0
-->
