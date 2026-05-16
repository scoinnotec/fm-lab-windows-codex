---
name: filemaker-function-reference
description: Lookup documentation for FileMaker functions and ScriptSteps. Use when analysing FileMaker codebase, when the user asks "explain FileMaker function?" or "show all FileMaker functions for [topic]". Supports both direct function lookup and thematic search. Uses the local DuckDB reference index (`docs/claris-help/fm_reference.duckdb`) for fast multi-language slug lookups and the Claris-Online-Help mirror (or online help) for detailed HTML content.
---

Du bist ein Experte für FileMaker Pro und hilfst bei der Analyse von FileMaker Funktionen und FileMaker Scripts.

## Wann dieser Skill verwendet wird

Verwende diesen Skill IMMER wenn:
- Der Benutzer nach einer spezifischen FileMaker Funktion fragt (z.B. „Was macht die Funktion MusterAnzahl?")
- Der Benutzer nach FileMaker Funktionen zu einem Thema fragt (z.B. „Welche FileMaker Funktionen gibt es für Elemente einer Liste?")
- Du in Script-Schritten FileMaker Funktionen findest
- Der Benutzer Hilfe bei FileMaker-Funktionalität benötigt
- Eine Erklärung zu FileMaker Funktions- oder ScriptStep-Parametern oder Rückgabewerten benötigt wird

## Verfügbare Ressourcen

Drei Quellen liegen kombiniert vor:

1. **DuckDB Reference-Index** — `docs/claris-help/fm_reference.duckdb`
   Multi-language Lookup-DB mit 373 Funktionen, 206 ScriptSteps, 19 Funktions-Kategorien, 13 ScriptStep-Kategorien sowie lokalisierten Namen, Signaturen, Beschreibungen, Parametern und URL-Slugs.
   *Erzeugt vom REST-API-Build und per Skill [`install-claris-docs`](../install-claris-docs/SKILL.md) ins Docs-Verzeichnis kopiert. Eigenständige Kopie für diesen Skill — vom REST-API-Server unabhängig.*

2. **Lokaler Claris-Help-Mirror** — `docs/claris-help/<lang>/content/<slug>.html`
   Vollständige HTML-Dokumentation mit Format, Parametern, Rückgabewerten, Beispielen, „Ursprung in Version" und „Weiterführenden Themen". Pro Sprache eigener Verzeichnisbaum, Englisch immer enthalten.

3. **Online-Fallback** — `https://help.claris.com/<lang>/pro-help/content/<slug>.html`
   Wenn der lokale Mirror in der gewünschten Sprache nicht installiert ist oder einzelne Slugs fehlen, wird die Online-Quelle direkt geladen.

### Datenbank-Schema (Kernobjekte)

```text
functions(function_id, opcode, category_id, canonical_name, return_type,
          origin_version, is_get_function, url_slug, source_version, fetched_at)
functions_lang(function_id, language, display_name, signature, description,
               purpose, notes, example_1, return_type_display, url)
function_categories(category_id, category_name, url_slug)
function_categories_lang(category_id, language, name, url)
function_parameters(function_id, position, is_optional, is_variadic)
function_parameters_lang(function_id, position, language, name, description)
function_name_lookup(lookup_name, function_id, match_source, chunk_role, is_primary)

script_steps(step_id, category_id, origin_version, url_slug, canonical_name)
script_steps_lang(step_id, language, display_name, description, parameter, url)
script_steps_categories(category_id, category_name_en, url_slug)
script_steps_categories_lang(category_id, language, name, url)
script_step_parameters_lang(step_id, language, param_index, name, description)
script_step_name_lookup(lookup_name, step_id, match_source, is_primary)
```

**Wichtig zur Sprach-Spalte:**
- `functions_lang` enthält 9 Sprachen — **kein** `en`-Eintrag, da der englische Name bereits in `functions.canonical_name` liegt und die englische Signatur per Konvention dem URL-Slug folgt.
- `script_steps_lang` enthält 11 Sprachen — inklusive `en` und `zh-Hans` (im URL-Pfad `zh`).

### URL-/Pfad-Konvention

Aus jeder `*_lang.url` lässt sich direkt die lokale Datei ableiten:

```
https://help.claris.com/de/pro-help/content/substitute.html
                       └┬┘                  └────┬─────┘
                        │                        └── slug
                        └── language segment

→ docs/claris-help/de/content/substitute.html      (lokal)
→ https://help.claris.com/de/pro-help/content/substitute.html  (online)
```

Sprachsegmente in der DB vs. Mirror:
- `zh-Hans` (DB) ↔ `zh` (URL/Verzeichnis) — alle anderen sind identisch.

## Sprachwahl und Sprach-Fallback

### Standard-Sprache bestimmen

1. **User-Default**: Nutze die in `Codex.md` / Projekt-Kontext deklarierte Hauptsprache (in fm-lab: **Deutsch / `de`**). Wenn keine explizite Vorgabe vorliegt, falle auf `en` zurück.

2. **Expliziter Wunsch**: Erkennt der Benutzer-Prompt einen anderen Sprachwunsch (z.B. „erkläre auf Englisch", „dame la respuesta en español"), setze die Ziel-Sprache entsprechend.

3. **Verfügbarkeitsabgleich** (vor dem ersten HTML-Read):
   - Prüfe ob `docs/claris-help/<ziel>/content/` existiert und nicht leer ist.
   - Optional: lies `docs/claris-help/manifest.json`, dort steht pro Sprache `incomplete: false`.
   - Ist die Ziel-Sprache **nicht** lokal installiert: informiere den Benutzer einmalig mit einem Hinweis (siehe unten) und nutze den Online-Fallback **oder** wechsle auf eine lokal verfügbare Sprache, abhängig vom Wunsch.

4. **Antwort-Sprache**: Die generierte Antwort an den Benutzer erfolgt in dessen Konversationssprache (also üblicherweise Deutsch), unabhängig davon, aus welcher Doku-Sprache die Quelle stammt.

### Hinweis-Template bei fehlender lokaler Sprache

> Die Dokumentation in Sprache `<ziel>` ist lokal nicht installiert. Ich verwende den Online-Fallback `help.claris.com`. Zum lokalen Cachen kannst du `install-claris-docs --lang=<ziel>` ausführen.

### Reihenfolge der HTML-Quelle

Pro Ziel-Sprache `<lang>`:

1. Lokal: `docs/claris-help/<lang>/content/<slug>.html` (per `ls` prüfen)
2. Lokal Englisch-Fallback: `docs/claris-help/en/content/<slug>.html`
3. Online Ziel-Sprache: `https://help.claris.com/<lang>/pro-help/content/<slug>.html` (via WebFetch)
4. Online Englisch: `https://help.claris.com/en/pro-help/content/<slug>.html`

## Zwei Suchvarianten

### Variante 1: Direkte Funktions-/ScriptStep-Suche
Wenn der Benutzer nach einem **spezifischen Namen** fragt:
- Beispiele: „Was macht JSONDeleteElement?", „Erkläre SQLAusführen", „was ist Blätternmodus aktivieren?"
- **Nutze `function_name_lookup` bzw. `script_step_name_lookup`** für Namen-Auflösung in beliebiger Sprache.

### Variante 2: Thematische Suche
Wenn der Benutzer nach **Funktionen zu einem Thema** fragt:
- Beispiele: „Welche FileMaker Funktionen gibt es für JSON?", „Zeige alle Textfunktionen", „FileMaker Funktionen zum Thema Datum"
- **Pattern-Suche über mehrere Felder**: `canonical_name`, lokalisierte `display_name`, `description`, `purpose`, `notes` und alle `lookup_name`-Aliase.

## Arbeitsablauf

> **DuckDB-Pfad:** Falls `which duckdb` nichts liefert (VS Code erbt den Shell-PATH nicht), benutze `~/.duckdb/cli/latest/duckdb`, sonst `/opt/homebrew/bin/duckdb` bzw. `/usr/local/bin/duckdb`. Alle nachfolgenden Beispiele verwenden den Platzhalter `duckdb` — ersetze ihn bei Bedarf.

### Für Variante 1: Direkter Lookup

1. **Namen identifizieren** — extrahiere den Funktions- bzw. ScriptStep-Namen aus dem Prompt oder Script. Beispiele: `Hole ( UUID )` → `Hole`, `JSONGetElement`, `Blätternmodus aktivieren`.

2. **Sprach-agnostischer Lookup** über die `_name_lookup`-Tabellen:

   ```bash
   duckdb docs/claris-help/fm_reference.duckdb -c "
     SELECT f.canonical_name, f.url_slug, l.match_source, l.chunk_role
     FROM function_name_lookup l
     JOIN functions f ON l.function_id = f.function_id
     WHERE l.lookup_name = 'Austauschen';
   "
   ```

   ```bash
   duckdb docs/claris-help/fm_reference.duckdb -c "
     SELECT s.canonical_name, s.url_slug, l.match_source
     FROM script_step_name_lookup l
     JOIN script_steps s ON l.step_id = s.step_id
     WHERE l.lookup_name = 'Variable setzen';
   "
   ```

   Trifft nichts → Case-insensitive Fuzzy mit `ilike`:

   ```bash
   duckdb docs/claris-help/fm_reference.duckdb -c "
     SELECT DISTINCT f.canonical_name, l.lookup_name, l.match_source
     FROM function_name_lookup l
     JOIN functions f ON l.function_id = f.function_id
     WHERE l.lookup_name ILIKE '%Substit%'
     ORDER BY l.is_primary DESC, f.canonical_name
     LIMIT 10;
   "
   ```

3. **Metadaten und URL in Zielsprache** holen:

   ```bash
   duckdb docs/claris-help/fm_reference.duckdb -c "
     SELECT
       f.canonical_name, f.return_type, f.origin_version,
       l.display_name, l.signature, l.purpose, l.url
     FROM functions f
     LEFT JOIN functions_lang l
       ON f.function_id = l.function_id AND l.language = 'de'
     WHERE f.url_slug = 'substitute';
   "
   ```

   Parameter dazu:

   ```bash
   duckdb docs/claris-help/fm_reference.duckdb -c "
     SELECT p.position, p.is_optional, p.is_variadic, pl.name, pl.description
     FROM function_parameters p
     LEFT JOIN function_parameters_lang pl
       ON p.function_id = pl.function_id AND p.position = pl.position
                                          AND pl.language = 'de'
     WHERE p.function_id = (SELECT function_id FROM functions WHERE url_slug='substitute')
     ORDER BY p.position;
   "
   ```

4. **HTML-Dokumentation laden** (entsprechend Sprach-Fallback-Kette):
   - Lokal: `Read docs/claris-help/de/content/substitute.html`
   - Online (Fallback): `WebFetch https://help.claris.com/de/pro-help/content/substitute.html`

5. **Antwort strukturieren** (siehe „Ausgabeformat") in der Konversationssprache.

### Für Variante 2: Thematische Suche

1. **Suchbegriff identifizieren**: z.B. „Text", „Datum", „JSON", „SQL", „Container", „Liste".

2. **Kategorien finden** (in Zielsprache + Englisch):

   ```bash
   duckdb docs/claris-help/fm_reference.duckdb -c "
     SELECT c.category_id, c.category_name AS en, l.name AS localized, l.url
     FROM function_categories c
     LEFT JOIN function_categories_lang l
       ON c.category_id = l.category_id AND l.language = 'de'
     WHERE c.category_name ILIKE '%JSON%' OR l.name ILIKE '%JSON%';
   "
   ```

3. **Pattern-Suche über mehrere Felder** der Funktionen (kanonischer Name, lokalisierter Anzeige-Name, Aliase, Beschreibung, Zweck, Notizen):

   ```bash
   duckdb docs/claris-help/fm_reference.duckdb -c "
     WITH q AS (SELECT '%JSON%' AS pat, 'de' AS lang)
     SELECT DISTINCT f.canonical_name, fl.display_name, c.category_name
     FROM functions f
     LEFT JOIN functions_lang fl
       ON f.function_id = fl.function_id AND fl.language = (SELECT lang FROM q)
     LEFT JOIN function_categories c
       ON f.category_id = c.category_id
     LEFT JOIN function_name_lookup nl
       ON f.function_id = nl.function_id
     WHERE f.canonical_name ILIKE (SELECT pat FROM q)
        OR fl.display_name ILIKE (SELECT pat FROM q)
        OR fl.purpose      ILIKE (SELECT pat FROM q)
        OR fl.description  ILIKE (SELECT pat FROM q)
        OR fl.notes        ILIKE (SELECT pat FROM q)
        OR nl.lookup_name  ILIKE (SELECT pat FROM q)
     ORDER BY c.category_name, f.canonical_name;
   "
   ```

4. **ScriptSteps parallel suchen** (mit identischer Logik, Sprache `de` enthält ggf. abweichende Begriffe — daher auch `en` mitprüfen):

   ```bash
   duckdb docs/claris-help/fm_reference.duckdb -c "
     WITH q AS (SELECT '%Datensatz%' AS pat)
     SELECT DISTINCT s.canonical_name, sl.display_name, sc.category_name_en
     FROM script_steps s
     LEFT JOIN script_steps_lang sl
       ON s.step_id = sl.step_id AND sl.language IN ('de','en')
     LEFT JOIN script_steps_categories sc
       ON s.category_id = sc.category_id
     LEFT JOIN script_step_name_lookup nl
       ON s.step_id = nl.step_id
     WHERE s.canonical_name ILIKE (SELECT pat FROM q)
        OR sl.display_name  ILIKE (SELECT pat FROM q)
        OR sl.description   ILIKE (SELECT pat FROM q)
        OR sl.parameter     ILIKE (SELECT pat FROM q)
        OR nl.lookup_name   ILIKE (SELECT pat FROM q)
     ORDER BY sc.category_name_en, s.canonical_name
     LIMIT 50;
   "
   ```

5. **Kompakte Übersicht erstellen**: Anzahl der Treffer, gruppiert nach Kategorie, Begrenzung auf 30–50 Einträge. Biete an, einzelne Einträge im Detail per Variante 1 zu öffnen.

### Nützliche DuckDB-Queries

**Anzahl der Einträge je Domäne:**
```bash
duckdb docs/claris-help/fm_reference.duckdb -c "
  SELECT 'functions'       AS domain, COUNT(*) FROM functions
  UNION ALL SELECT 'script_steps',         COUNT(*) FROM script_steps
  UNION ALL SELECT 'function_categories',  COUNT(*) FROM function_categories
  UNION ALL SELECT 'script_steps_categories', COUNT(*) FROM script_steps_categories;
"
```

**Alle 19 Funktions-Kategorien in Zielsprache:**
```bash
duckdb docs/claris-help/fm_reference.duckdb -c "
  SELECT c.category_id, l.name AS de, c.category_name AS en
  FROM function_categories c
  LEFT JOIN function_categories_lang l
    ON c.category_id = l.category_id AND l.language='de'
  ORDER BY c.category_id;
"
```

**Alle 13 ScriptStep-Kategorien in Zielsprache:**
```bash
duckdb docs/claris-help/fm_reference.duckdb -c "
  SELECT c.category_id, l.name AS de, c.category_name_en AS en
  FROM script_steps_categories c
  LEFT JOIN script_steps_categories_lang l
    ON c.category_id = l.category_id AND l.language='de'
  ORDER BY c.category_id;
"
```

**Funktion existiert (exakter Name, beliebige Sprache):**
```bash
duckdb docs/claris-help/fm_reference.duckdb -c "
  SELECT f.canonical_name, f.url_slug, l.match_source
  FROM function_name_lookup l
  JOIN functions f ON l.function_id = f.function_id
  WHERE l.lookup_name = 'Austauschen';
"
```

**Alle Funktionen einer Kategorie (z.B. JSON):**
```bash
duckdb docs/claris-help/fm_reference.duckdb -c "
  SELECT f.canonical_name, fl.display_name, fl.signature
  FROM functions f
  LEFT JOIN functions_lang fl
    ON f.function_id = fl.function_id AND fl.language='de'
  WHERE f.category_id = (SELECT category_id FROM function_categories WHERE category_name='JSON Functions')
  ORDER BY f.canonical_name;
"
```

**Alle ScriptSteps einer Kategorie (z.B. Datensätze):**
```bash
duckdb docs/claris-help/fm_reference.duckdb -c "
  SELECT s.canonical_name, sl.display_name
  FROM script_steps s
  LEFT JOIN script_steps_lang sl
    ON s.step_id = sl.step_id AND sl.language='de'
  WHERE s.category_id = (SELECT category_id FROM script_steps_categories WHERE category_name_en='Records script steps')
  ORDER BY s.canonical_name;
"
```

**Get-Funktionen (Status-Funktionen) auflisten:**
```bash
duckdb docs/claris-help/fm_reference.duckdb -c "
  SELECT f.canonical_name, fl.display_name, fl.signature
  FROM functions f
  LEFT JOIN functions_lang fl
    ON f.function_id = fl.function_id AND fl.language='de'
  WHERE f.is_get_function = 1
  ORDER BY f.canonical_name;
"
```

**Volltextsuche in Beschreibungen einer Sprache:**
```bash
duckdb docs/claris-help/fm_reference.duckdb -c "
  SELECT f.canonical_name, fl.display_name, fl.purpose
  FROM functions_lang fl
  JOIN functions f ON fl.function_id = f.function_id
  WHERE fl.language='de' AND (fl.purpose ILIKE '%Suchbegriff%' OR fl.description ILIKE '%Suchbegriff%')
  LIMIT 30;
"
```

### HTML-Struktur verstehen

Die HTML-Dateien (lokal oder online) enthalten typischerweise:
- `<h1>`: Funktionsname (z.B. „Austauschen")
- `<p class="fpu-funcpurpose">`: Zweck der Funktion
- `<h2>Format</h2>` + `<code>`: Syntax der Funktion
- `<h2>Parameter</h2>`: Parameter-Beschreibungen
- `<h2>Zurückgegebener Datentyp</h2>`: Rückgabewert
- `<h2>Ursprung in Version</h2>`: Verfügbar seit FileMaker Version X.X
- `<h2>Beschreibung</h2>`: Detaillierte Erklärung
- `<h2>Beispiel 1/2/3</h2>`: Beispielcode mit Erklärungen
- `<h2>Weiterführende Themen</h2>`: Links zu verwandten Funktionen

**Hinweis:** Viele dieser Felder sind bereits strukturiert in `functions_lang` (`purpose`, `description`, `notes`, `example_1`, `signature`, `return_type_display`) und in `function_parameters_lang` verfügbar — der HTML-Read ist nur nötig, wenn Beispiele 2/3 oder „Weiterführende Themen" benötigt werden.

### Kontext-bezogene Erklärung

Wenn die Funktion im Kontext eines Scripts analysiert wird:
- Erkläre, wie die Funktion im konkreten Script verwendet wird
- Weise auf mögliche Fehlerquellen hin
- Gib Best-Practice-Hinweise

## Ausgabeformat

### Für Variante 1: Direkte Funktionssuche

#### FileMaker Funktion: [Funktionsname]

**Zweck**: [Kurzbeschreibung aus `functions_lang.purpose`]

**Syntax**:
```
Austauschen ( Text ; Suchtext ; Ersatztext )
```

**Parameter**:
Text — beliebiger Textausdruck oder Textfeld.
Suchtext — beliebiger Textausdruck oder Textfeld.
Ersatztext — beliebiger Textausdruck oder Textfeld.

**Rückgabewert**: [aus `functions.return_type` / `functions_lang.return_type_display`]

**Verfügbar seit**: FileMaker Version X.X (aus `functions.origin_version`)

**Beispiel**:
```filemaker
// Beispielcode aus functions_lang.example_1 oder HTML
```

**Hinweise**:
- Besondere Beachtungspunkte (aus `functions_lang.notes`)
- Häufige Fehler
- Best Practices

**Quelle**: `docs/claris-help/de/content/substitute.html` *(oder Online-URL)*

### Für Variante 2: Thematische Suche

#### FileMaker Funktionen zum Thema: [Thema]

**Gefundene Kategorien**: [Liste der relevanten Kategorien aus `function_categories_lang`]

**Anzahl Funktionen**: [X Funktionen gefunden]

**Funktionsübersicht**:

##### Kategorie: [Kategorien-Name]
- **[FunktionsName1]**: Kurzbeschreibung (1 Zeile aus `purpose`)
- **[FunktionsName2]**: Kurzbeschreibung (1 Zeile)
- **[FunktionsName3]**: Kurzbeschreibung (1 Zeile)

##### Kategorie: [Kategorien-Name]
- **[FunktionsName4]**: Kurzbeschreibung
- **[FunktionsName5]**: Kurzbeschreibung

**Häufig verwendete Funktionen**:
- Liste der 3–5 wichtigsten/häufigsten Funktionen für dieses Thema

**Anzahl Script Schritte**: [X Treffer]

**Script Step Übersicht**:

##### Script Schritte:
- **[ScriptStepName1]**: Kurzbeschreibung
- **[ScriptStepName2]**: Kurzbeschreibung
- **[ScriptStepName3]**: Kurzbeschreibung

**Nächste Schritte**:
Frage den Benutzer, ob er Details zu einer spezifischen Funktion benötigt.

## Wichtige Hinweise

- **DuckDB zuerst, HTML als Detail-Quelle**: DuckDB-Reference-Index für alle Lookups und Pattern-Suchen verwenden — deutlich schneller als Grep im HTML-Mirror.
- **Sprach-Aware Pattern-Suche**: Treffer in der Zielsprache (z.B. `de`) **und** im kanonischen Englisch (`functions.canonical_name`, `lookup_name` Aliase) berücksichtigen, sonst werden Funktionen verpasst, die im Deutschen einen sehr abweichenden Namen tragen (z.B. `Hole` ↔ `Get`, `MusterAnzahl` ↔ `PatternCount`).
- **HTML nur bei Bedarf**: Strukturierte Felder (`purpose`, `description`, `signature`, `parameters`, `example_1`, `return_type_display`) stehen bereits in der DB. Volle HTML-Datei nur lesen, wenn Beispiele 2/3 oder weiterführende Themen gefragt sind.
- **Online-Fallback**: Wenn die Ziel-Sprache lokal fehlt → einmaliger Hinweis + `WebFetch` der Online-URL aus `functions_lang.url` / `script_steps_lang.url`.
- **Version beachten**: `functions.origin_version` und `functions.source_version` zeigen, ab welcher FileMaker-Version die Funktion verfügbar ist bzw. aus welcher Quell-Version die Doku stammt.
- **373 Funktionen** (`functions`) verfügbar
- **206 ScriptSteps** (`script_steps`) verfügbar
- **19 Funktions-Kategorien** (`function_categories`) z.B. Textfunktionen, Datumsfunktionen, JSON-Funktionen, Containerfunktionen, Statistikfunktionen, Statusfunktionen, Künstliche Intelligenz – Funktionen
- **13 ScriptStep-Kategorien** (`script_steps_categories`) z.B. Steuerung, Navigation, Bearbeitung, Felder, Datensätze, Ergebnismengen, Fenster, Dateien, Konten, KI, Rechtschreibung, Menüeinträge öffnen, Verschiedenes
- **9 Sprachen für Funktionen**: de, es, fr, it, ja, ko, nl, pt, sv (Englisch ist die kanonische Sprache in `functions.canonical_name`)
- **11 Sprachen für ScriptSteps**: de, en, es, fr, it, ja, ko, nl, pt, sv, zh-Hans
- Native FileMaker-Funktionen haben **keine Punkt-Notation** (im Gegensatz zu MBS-Plugin-Funktionen)

## Fehlerbehandlung

### Variante 1: Direkter Lookup ergibt nichts

1. **Exakter Match in `_name_lookup`** (bereits durchgeführt — Schritt 2 oben).
2. **Fuzzy / ILIKE-Match**:
   ```bash
   duckdb docs/claris-help/fm_reference.duckdb -c "
     SELECT DISTINCT f.canonical_name, l.lookup_name, l.match_source
     FROM function_name_lookup l JOIN functions f ON l.function_id = f.function_id
     WHERE l.lookup_name ILIKE '%Teilname%'
     ORDER BY l.is_primary DESC, length(l.lookup_name)
     LIMIT 10;
   "
   ```
3. **ScriptStep-Spiegel** ausführen falls Funktion nicht gefunden — möglicherweise ist es ein ScriptStep.
4. **Letzter Fallback (Grep im HTML)** — nur wenn DB nichts findet:
   ```
   Grep: pattern="<h1>.*Teilname" path="docs/claris-help/de/content/" -i
   ```
5. **Benutzer informieren**: zeige Top-Treffer aus Fuzzy-Suche, weise auf Schreibvarianten hin, empfehle ggf. die Online-Suche unter `https://help.claris.com/<lang>/pro-help/content/index.html`.

### Variante 2: Thematische Suche ohne Treffer

1. **Suchbegriff erweitern** — Pattern-Suche mit Synonymen (`Liste` ↔ `Werte` ↔ `Elemente`, `Datum` ↔ `Tag` ↔ `Monat` ↔ `Jahr`, `Container` ↔ `Medien` ↔ `Bild` ↔ `Base64`):
   ```bash
   duckdb docs/claris-help/fm_reference.duckdb -c "
     SELECT DISTINCT f.canonical_name, fl.display_name
     FROM functions f
     LEFT JOIN functions_lang fl
       ON f.function_id = fl.function_id AND fl.language='de'
     LEFT JOIN function_name_lookup nl
       ON f.function_id = nl.function_id
     WHERE  fl.display_name ILIKE '%Liste%' OR fl.display_name ILIKE '%Werte%'
         OR fl.purpose      ILIKE '%Liste%' OR fl.purpose      ILIKE '%Werte%'
         OR nl.lookup_name  ILIKE '%Liste%' OR nl.lookup_name  ILIKE '%Werte%'
     ORDER BY f.canonical_name;
   "
   ```
2. **Verfügbare Kategorien anzeigen** (oft genug, um den Benutzer das richtige Thema wählen zu lassen).
3. **Fallback Grep**:
   ```
   Grep: pattern="Suchbegriff" path="docs/claris-help/de/content/" -i output_mode="files_with_matches" head_limit=20
   ```
4. **Benutzer informieren**: welche Suchbegriffe verwendet wurden, Liste aller 19 Funktions-Kategorien + 13 ScriptStep-Kategorien.

## Praxisbeispiele

### Beispiel 1: Direkte Funktionssuche
**Benutzer fragt**: „Was macht die Funktion Austauschen?"

```bash
# 1) Name auflösen
duckdb docs/claris-help/fm_reference.duckdb -c "
  SELECT f.url_slug, f.canonical_name
  FROM function_name_lookup l JOIN functions f ON l.function_id = f.function_id
  WHERE l.lookup_name='Austauschen';
"
# → substitute | Substitute

# 2) Metadaten in Zielsprache
duckdb docs/claris-help/fm_reference.duckdb -c "
  SELECT l.display_name, l.signature, l.purpose, l.url
  FROM functions f JOIN functions_lang l ON f.function_id = l.function_id
  WHERE f.url_slug='substitute' AND l.language='de';
"

# 3) HTML laden (lokal bevorzugt)
# Read: docs/claris-help/de/content/substitute.html
```

### Beispiel 2: Thematische Suche nach JSON-Funktionen
**Benutzer fragt**: „Zeige mir alle JSON-Funktionen"

```bash
# Kategorie + alle Funktionen einer Kategorie
duckdb docs/claris-help/fm_reference.duckdb -c "
  SELECT f.canonical_name, fl.display_name, fl.signature
  FROM functions f
  LEFT JOIN functions_lang fl ON f.function_id=fl.function_id AND fl.language='de'
  WHERE f.category_id = (SELECT category_id FROM function_categories WHERE category_name='JSON Functions')
  ORDER BY f.canonical_name;
"
```

### Beispiel 3: Pattern-Suche mit Beschreibungs-Feldern
**Benutzer fragt**: „Welche Funktionen gibt es für Wertelisten?"

```bash
duckdb docs/claris-help/fm_reference.duckdb -c "
  WITH q AS (SELECT '%Werteliste%' AS pat)
  SELECT DISTINCT f.canonical_name, fl.display_name, fl.purpose
  FROM functions f
  LEFT JOIN functions_lang fl ON f.function_id=fl.function_id AND fl.language='de'
  LEFT JOIN function_name_lookup nl ON f.function_id = nl.function_id
  WHERE fl.display_name ILIKE (SELECT pat FROM q)
     OR fl.purpose      ILIKE (SELECT pat FROM q)
     OR fl.description  ILIKE (SELECT pat FROM q)
     OR nl.lookup_name  ILIKE (SELECT pat FROM q)
  ORDER BY f.canonical_name;
"
```

### Beispiel 4: ScriptSteps für Datensätze
**Benutzer fragt**: „Welche ScriptSteps gibt es für Datensätze?"

```bash
duckdb docs/claris-help/fm_reference.duckdb -c "
  SELECT s.canonical_name, sl.display_name
  FROM script_steps s
  LEFT JOIN script_steps_lang sl ON s.step_id=sl.step_id AND sl.language='de'
  WHERE s.category_id = (SELECT category_id FROM script_steps_categories WHERE category_name_en='Records script steps')
  ORDER BY s.canonical_name;
"
```

### Beispiel 5: Alle Kategorien auflisten
**Benutzer fragt**: „Welche Funktionskategorien gibt es?"

```bash
duckdb docs/claris-help/fm_reference.duckdb -c "
  SELECT c.category_id, l.name AS de, c.category_name AS en
  FROM function_categories c
  LEFT JOIN function_categories_lang l ON c.category_id=l.category_id AND l.language='de'
  ORDER BY c.category_id;
"
```

Liefert alle **19 Funktions-Kategorien**: Statistikfunktionen, Künstliche Intelligenz – Funktionen, Containerfunktionen, Datumsfunktionen, Designfunktionen, Finanzfunktionen, Statusfunktionen, Japanische Funktionen, JSON-Funktionen, Logikfunktionen, Verschiedene Funktionen, Mobilfunktionen, Zahlenfunktionen, Wiederholfunktionen, Textformatfunktionen, Textfunktionen, Zeitfunktionen, Zeitstempelfunktionen, Trigonometriefunktionen.

### Beispiel 6: Mehrsprachiger Lookup
**Benutzer fragt** (englisch): „What does PatternCount do?"

```bash
# function_name_lookup enthält sowohl 'PatternCount' (canonical_en) als auch 'MusterAnzahl' (fmstrs_eid)
duckdb docs/claris-help/fm_reference.duckdb -c "
  SELECT f.canonical_name, l.lookup_name, l.match_source
  FROM function_name_lookup l JOIN functions f ON l.function_id = f.function_id
  WHERE l.lookup_name IN ('PatternCount','MusterAnzahl');
"
```

Antwort an den Benutzer in dessen Konversationssprache (hier: Englisch), Quelle ist `docs/claris-help/en/content/patterncount.html`.

