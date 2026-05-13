---
name: install-claris-docs
description: Download and install Claris FileMaker Pro online help (help.claris.com) as a local mirror in `docs/claris-help/`. Supports 11 languages with English as the always-included reference language. Also copies the REST-API reference index DB (`fm_reference.duckdb`) into the docs directory for fast slug lookups. Maintains a manifest and per-language version markers and prompts before replacing existing language sets.
---

# Claris Online-Help Installations-Skill

## Wann diesen Skill verwenden

Verwende diesen Skill, wenn:

- Die Claris-Online-Hilfe lokal als Referenz benötigt wird (für `filemaker-function-reference`, `fm-summarize`, `fm-analyze`, REST-API-Reference-Endpunkte etc.)
- Eine neue Sprache zur bestehenden Installation hinzugefügt werden soll
- Auf eine neuere Version der Claris-Hilfe aktualisiert werden soll
- Nach Korruption oder versehentlichem Löschen die Doku neu installiert werden muss
- Die Reference-Index-DB (`fm_reference.duckdb`) aktualisiert werden soll, damit Slug-Lookups (Funktion/ScriptStep → HTML-Datei) lokal per DuckDB-Query möglich sind

Der Skill automatisiert:
- Crawling der Claris-Online-Hilfe (`https://help.claris.com/<lang>/pro-help/content/index.html`)
- Mehrsprachiger Download (10 verfügbare Sprachen plus Englisch als Referenz)
- Mirroring inkl. CSS, JS, Bilder für offline-fähige Darstellung
- Versions-Tracking via HTTP `Last-Modified` (pro Sprache)
- Manifest-Pflege in `docs/claris-help/manifest.json`
- User-Bestätigung beim Ersetzen vorhandener Sprach-Sets
- **Kopieren der Reference-Index-DB** aus `rest-api/db/fm_reference.duckdb` nach `docs/claris-help/fm_reference.duckdb` (Standard-Schritt, deaktivierbar via `--skip-reference-db`)

## Wichtig: Sprachauswahl

**Englisch (`en`) wird IMMER heruntergeladen** — unabhängig von der Benutzervorgabe. Das stellt sicher, dass eine konsistente Referenzsprache verfügbar ist (Slugs, kanonische Namen, Fallback bei fehlenden Übersetzungen).

Drei Auswahl-Modi:
- **a) Nur Englisch** — minimaler Set für CI / nicht-deutschsprachige Entwicklung
- **b) Englisch + eine Sprache** — Standard für lokalisierte Entwicklung
- **c) Alle Sprachen** — vollständiger Mirror (~10× Datenvolumen)

### Verfügbare Sprachen

| Code | Sprache              | Verfügbar | Hinweis                              |
|------|----------------------|-----------|--------------------------------------|
| `en` | Englisch             | immer     | Referenz, immer enthalten            |
| `de` | Deutsch              | ✓         |                                      |
| `es` | Spanisch             | ✓         |                                      |
| `fr` | Französisch          | ✓         |                                      |
| `it` | Italienisch          | ✓         |                                      |
| `nl` | Niederländisch       | ✓         |                                      |
| `pt` | Portugiesisch        | ✓         |                                      |
| `sv` | Schwedisch           | ✓         |                                      |
| `ja` | Japanisch            | ✓         |                                      |
| `ko` | Koreanisch           | ✓         |                                      |
| `zh` | Chinesisch (vereinf.)| ✓         | URL-Segment ist `zh` (nicht `zh-Hans`)|

## Workflow

Wenn der Skill aufgerufen wird:

1. **Sprachpräferenz ermitteln** — Frage den Benutzer (per `AskUserQuestion`) nach der gewünschten Sprache, falls nicht explizit angegeben. Verfügbare Optionen:
   - „Nur Englisch (en)"
   - „Englisch + meine Hauptsprache" → konkrete Sprache nachfragen (de empfohlen)
   - „Alle Sprachen"

2. **Existing Docs prüfen** — Lies `docs/claris-help/manifest.json` (falls vorhanden) zur Bestimmung des aktuellen Stands.

3. **Versions-Check** — Vergleiche pro Sprache das gespeicherte Datum mit dem `Last-Modified` der `content/index.html`. Bei Update: User fragen (außer `--force`).

4. **Crawl & Download** — Starte den Crawler pro Sprache, lade rekursiv alle `.html`-Dateien plus referenzierte Assets (CSS, JS, Bilder).

5. **Manifest aktualisieren** — Pro Sprache: Anzahl heruntergeladener Dateien, Zeitstempel, Quell-URL.

6. **Reporting** — Zusammenfassung mit Anzahl Sprachen, Gesamtdateien, Größe.

## Skill-Aufruf vom Assistenten

Der Skill verwendet **AskUserQuestion** zur interaktiven Sprachauswahl. Wenn der Benutzer die Sprache explizit nennt (z.B. „install claris docs in German"), kann die Frage übersprungen werden.

### Schritt 1: Sprachpräferenz klären

Verwende `AskUserQuestion` mit folgender Struktur (sofern nicht explizit angegeben):

```
Question: "Welche Sprachen der Claris-Online-Hilfe sollen installiert werden? (Englisch ist immer enthalten)"
Header:   "Sprachauswahl"
Options:
  - "Englisch + Deutsch"      (Recommended)
  - "Nur Englisch"
  - "Alle Sprachen (10 + EN)"
```

### Schritt 2: Skript ausführen

```bash
# Nur Englisch
bash .claude/skills/install-claris-docs/scripts/install_claris_docs.sh

# Englisch + Deutsch
bash .claude/skills/install-claris-docs/scripts/install_claris_docs.sh --lang=de

# Alle Sprachen
bash .claude/skills/install-claris-docs/scripts/install_claris_docs.sh --all

# Force (Versions-Check überspringen)
bash .claude/skills/install-claris-docs/scripts/install_claris_docs.sh --lang=de --force

# Sprachen auflisten ohne zu installieren
bash .claude/skills/install-claris-docs/scripts/install_claris_docs.sh --list-languages
```

### Schritt 3: Ergebnis kommunizieren

Das Skript gibt strukturiertes Logging aus. Berichte:
- Welche Sprachen wurden installiert / aktualisiert / übersprungen
- Anzahl der heruntergeladenen Seiten und Größe
- Speicherort: `docs/claris-help/<lang>/`

## Script-Parameter

| Flag                  | Wirkung                                                                       |
|-----------------------|-------------------------------------------------------------------------------|
| `--lang=<code>`       | Eine zusätzliche Sprache zu Englisch (z.B. `--lang=de`)                       |
| `--lang=all`          | Alle 10 verfügbaren Sprachen plus Englisch (Synonym für `--all`)              |
| `--all`               | Alle 10 verfügbaren Sprachen plus Englisch                                    |
| `--force`             | Versions-Check und Nachfrage überspringen — bestehende Sprach-Sets ersetzen   |
| `--list-languages`    | Liste der verfügbaren Sprachen ausgeben (mit Verfügbarkeits-Check via HTTP)   |
| `--max-workers=<n>`   | Anzahl paralleler Downloads pro Sprache (Default: 8)                          |
| `--dry-run`           | Nur Crawling/Discovery durchführen, keine Dateien schreiben                   |
| `--skip-reference-db` | Reference-DB-Kopie überspringen (Standard: immer kopieren)                    |
| `--restart-server`    | API-Server zwingend stoppen/neustarten beim Ref-DB-Kopieren (für Edge-Cases)  |

Ohne Parameter wird **nur Englisch** installiert (plus immer die Reference-DB, sofern vorhanden).

## Verzeichnisstruktur

Nach Installation:

```
docs/claris-help/
├── manifest.json                     # Globales Manifest
├── fm_reference.duckdb               # Reference-Index-DB (Kopie aus rest-api/db/)
├── en/                                # Englisch (Referenz, immer enthalten)
│   ├── .version                       # JSON: Last-Modified + Datei-Counts
│   ├── content/                       # Alle HTML-Seiten
│   │   ├── index.html
│   │   ├── functions-reference.html
│   │   ├── set-variable.html
│   │   └── ... (~1000 Dateien)
│   ├── Resources/                     # Scripts, Templates aus ../Resources/
│   ├── Skins/                         # CSS, Themes aus ../Skins/
│   └── assets/                        # Globale Assets aus /assets/
├── de/                                # Deutsch (analog)
├── es/
└── ...
```

## Reference-Index-DB

Zusätzlich zum HTML-Mirror kopiert der Skill standardmäßig die Reference-Index-Datenbank aus dem REST-API in das Docs-Verzeichnis:

```
rest-api/db/fm_reference.duckdb  →  docs/claris-help/fm_reference.duckdb
```

**Zweck:** Schnelle Identifikation relevanter HTML-Dokumente per DuckDB-Query — z.B. „Welche HTML-Datei dokumentiert die Funktion `MusterAnzahl`?" Statt Volltext-Suche im Mirror reicht ein Slug-Lookup gegen die Index-DB. Wird von `filemaker-function-reference`, `fm-summarize`, `fm-analyze` und anderen Skills genutzt, sobald sie eine Funktion oder einen ScriptStep zu einer HTML-Datei auflösen müssen.

### Kopier-Strategie

Der REST-API-Server attached die Reference-DB im **READ\_ONLY-Modus** (`rest-api/src/config/database.js`), wodurch DuckDB keine WAL-Datei erzeugt und keinen Write-Lock hält. Eine direkte `cp`-Operation während des laufenden Servers ist daher unkritisch — der Server liest weiter aus der bisherigen Datei, das Zielverzeichnis (`docs/claris-help/`) ist unabhängig.

**Ablauf des Skripts:**

1. **Prüfung:** Existiert `rest-api/db/fm_reference.duckdb`?
   - Nein → Schritt wird mit Warnung übersprungen (kein Fehler).
2. **Direktkopie** (Standard): atomar via `*.tmp` + `mv`, ohne den Server zu berühren.
3. **Fallback bei Fehler:** Schlägt die Direktkopie fehl und ein Server läuft auf Port 3003, werden automatisch `tools/stop-servers.sh` → Kopie → `tools/start-servers.sh` ausgeführt.
4. **`--restart-server` Flag:** Erzwingt den Stop/Start-Zyklus auch dann, wenn die Direktkopie funktionieren würde (für Edge-Cases oder wenn der Server-Reload explizit gewünscht ist).
5. **`--skip-reference-db` Flag:** Schritt komplett überspringen (z.B. wenn nur die HTML-Doku gespiegelt werden soll).

### Quelle der Reference-DB

Die Reference-DB wird **nicht** von diesem Skill erzeugt — sie ist Teil des `rest-api/`-Setups und wird üblicherweise gemeinsam mit dem REST-API-Server verteilt. Ist `rest-api/db/fm_reference.duckdb` nicht vorhanden, ist das kein Fehlerfall: das Skript fährt mit den HTML-Downloads fort und meldet im Summary `Ref-DB: source not found — skipped`.

### `manifest.json` Schema

```jsonc
{
  "$schema_version": 1,
  "source": "Claris FileMaker Pro Online Help",
  "source_url": "https://help.claris.com",
  "fetched_at": "2026-05-12T10:15:30Z",
  "fallback_language": "en",
  "languages": [
    {
      "code": "en",
      "url_lang_segment": "en",
      "url_root": "https://help.claris.com/en/pro-help/",
      "html_pages": 1019,
      "asset_files": 84,
      "total_size_bytes": 41527890,
      "last_modified": "Mon, 13 Jan 2026 10:15:30 GMT",
      "fetched_at": "2026-05-12T10:15:30Z",
      "incomplete": false
    },
    {
      "code": "de",
      ...
    }
  ]
}
```

## Voraussetzungen

- **Python 3** (für den Crawler, üblicherweise vorinstalliert auf macOS)
- **curl** (für Version-Checks, vorinstalliert)
- **Internet-Verbindung** zu `help.claris.com`
- Schreibrechte auf `docs/claris-help/`

## Disk Space & Dauer

| Set                    | Dateien | Größe (geschätzt) | Download-Dauer |
|------------------------|---------|-------------------|----------------|
| Nur Englisch           | ~1100   | ~50 MB            | 2-3 Minuten    |
| Englisch + 1 Sprache   | ~2200   | ~100 MB           | 4-6 Minuten    |
| Alle 11 Sprachen       | ~12000  | ~550 MB           | 20-30 Minuten  |

Bei vorhandenem Cache (gleiche Version) wird das Re-Downloading übersprungen.

## Error Handling

### Netzwerk-Fehler
- Curl/Python urllib gibt detaillierte Fehler bei Unerreichbarkeit von `help.claris.com`
- Pro Datei wird bis zu 3× retry (mit Backoff) versucht
- Bei dauerhaftem Fehler einer Datei: Skript läuft weiter, markiert Sprache als `incomplete: true` im Manifest

### Disk Space
- Vor dem Download wird `df` geprüft, ob mindestens das doppelte des zu erwartenden Volumens frei ist
- Bei Speichermangel: Abbruch mit klarer Fehlermeldung

### HTTP-Fehler (404, 5xx)
- 404: einzelne fehlende Slugs werden geloggt aber nicht abgebrochen
- 5xx: Retry; nach 3 Fehlversuchen wird die Sprache mit `incomplete: true` markiert

### Korrupte/unvollständige Downloads
- Dateien werden zunächst nach `*.tmp` heruntergeladen, dann atomar umbenannt
- Bei Abbruch verbleiben nur vollständige Dateien

## Output-Format

**Erfolgreiche Installation:**
```
Installing Claris Online Help...
Languages: en (always), de
Target: docs/claris-help/

[en] Discovering pages from index.html...
[en] Found 1078 HTML pages, 84 assets
[en] Downloading (8 workers)... ████████████████████ 100% (1162/1162)
[en] Done: 47.3 MB, 12.4 s

[de] Discovering pages from index.html...
[de] Found 1071 HTML pages, 84 assets
[de] Downloading (8 workers)... ████████████████████ 100% (1155/1155)
[de] Done: 49.1 MB, 13.1 s

SUCCESS: Claris documentation installed
  Languages: en, de
  Total: 2317 files, 96.4 MB
  Location: docs/claris-help/
  Manifest: docs/claris-help/manifest.json
```

**Bereits aktuell:**
```
Checking for updates...
[en] Up to date (last-modified: Mon, 13 Jan 2026 10:15:30 GMT)
[de] Up to date (last-modified: Mon, 13 Jan 2026 10:15:30 GMT)

No action needed.
```

**Mit Update-Prompt:**
```
Checking for updates...
[en] Newer version available.
     Current: Sun, 12 Jan 2026 16:47:42 GMT
     Remote:  Mon, 20 Jan 2026 10:15:30 GMT
Replace existing 'en' docs? (y/n): y
[en] Downloading...
```

**Fehler:**
```
ERROR: [konkrete Fehlermeldung]
[Hinweis zur Behebung]
```

## Notes

- Die heruntergeladenen Dateien stammen von einer öffentlich zugänglichen Quelle (Claris-Online-Hilfe). Lokale Nutzung ist üblicherweise von Claris-Doku-Lizenz gedeckt; öffentliches Re-Publishing ist NICHT zulässig.
- Diese Dokumentation wird vom geplanten `fm_reference.duckdb`-Setup und den `/api/reference/...`-Endpunkten als HTML-Quelle für Volltext-Extraktion genutzt (siehe `project/plan_reference_data_architecture.md` im fm-lab-vscode-Repo).
- Das Skript ist idempotent — mehrfaches Ausführen ist sicher.
- Wenn nur einzelne Slugs fehlen oder veraltet sind, lohnt sich kein Komplett-Reinstall — der Crawler nutzt Last-Modified-Header pro Datei (HEAD-Request), um nur Geänderte zu aktualisieren.
