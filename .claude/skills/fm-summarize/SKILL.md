---
name: fm-summarize
description: Erzeugt eine technische Zusammenfassung eines FileMaker-Objekts (Script, Field, Layout, CustomFunction, ValueList, BaseTable, TableOccurrence, Relationship, etc.) aus der DuckDB-Datenbank `db/fm_catalog.duckdb`. Verwendet ObjectCatalog/ObjectLinks für Auflösung und Abhängigkeiten und erzeugt eine strukturierte Markdown-Beschreibung in deutscher Sprache. Unterstützt zwei Modi — Standard (vollständig mit Ablauf und Abhängigkeiten) und Kurz (1-2 Absätze Fließtext, via `--short` Flag oder Trigger-Wörter wie "kurz", "knapp", "1-2 Sätze", "Kurzbeschreibung", "TL;DR"). Wird ausgelöst durch Anfragen wie "beschreibe Script X", "fasse das Feld X zusammen", "/fm-summarize", "erkläre mir das Layout X technisch", oder wenn ein zuvor identifiziertes FileMaker-Objekt dokumentiert werden soll.
---

# FileMaker Objekt-Zusammenfassung

Erzeuge eine strukturierte, technische Beschreibung eines FileMaker-Objekts auf Basis der DuckDB-Datenbank `db/fm_catalog.duckdb`.

## Grundregeln

- **Sprache**: Deutsch
- **Datenbank**: `db/fm_catalog.duckdb` (DuckDB CLI, NICHT MotherDuck MCP)
- **Aufruf**: `duckdb db/fm_catalog.duckdb -c "<SQL>"` via Bash
- **Datei-Referenzen**: Markdown-Links (z.B. `[Script_Name](db/fm_catalog.duckdb)`)
- **Vor jeder DB-Abfrage**: Sicherstellen, dass das Objekt eindeutig identifiziert ist (siehe Schritt 1)

## Ausgabe-Modi

Es gibt zwei Modi, die unterschiedlich umfangreiche Ausgaben erzeugen:

### Standard-Modus (Default)

Ausführliche Markdown-Zusammenfassung mit allen Sektionen — Header, Zweck, technische Details, Ablauf (bei Scripts nummeriert), Verwendet, Wird verwendet von, Hinweise. Genaues Format siehe Schritt 4.

### Kurz-Modus (`--short`)

1-2 Absätze **Fließtext**, **keine** Markdown-Sektionen, **keine** Tabellen, **keine** Code-Blöcke. Enthält nur den Kern: was das Objekt ist und was es bewirkt, optional mit grobem Aufrufer-/Aufgerufenes-Hinweis.

**Aktivierung des Kurz-Modus**:

1. **Explizites Flag** in der Skill-Aufrufung — Position frei (vor oder nach dem Objektnamen):
   ```
   /fm-summarize Faktura_RechnungDrucken --short
   /fm-summarize --short Faktura_RechnungDrucken
   /fm-summarize --short <UUID>
   ```

2. **Natürliche Sprache** — Wenn die Benutzer-Anfrage einen der folgenden Begriffe enthält, automatisch den Kurz-Modus aktivieren, auch ohne explizites `--short`:
   - "kurz" (z.B. "beschreibe das Script X kurz")
   - "knapp", "knappe Zusammenfassung"
   - "1-2 Sätze", "in wenigen Sätzen"
   - "Kurzbeschreibung"
   - "TL;DR", "TLDR"
   - "grob", "überblicksartig"

**Modus-Unterschiede**:

| Sektion | Standard | `--short` |
|---------|----------|-----------|
| Header (Name, Typ, Datei, UUID) | ✓ | ✗ (nur Inline-Erwähnung im Fließtext) |
| Zweck | ✓ | ✓ (Kern des Kurz-Outputs) |
| Technische Details | ✓ | ✗ |
| Ablauf (bei Scripts) | nummeriert, vollständig | ✗ (höchstens 1 Halbsatz: "Ruft 4 Sub-Scripts auf") |
| Verwendet | gruppiert nach Link_Role | ✗ |
| Wird verwendet von | gruppiert | ✗ (höchstens "von 3 Stellen aufgerufen") |
| Hinweise | ✓ | nur kritisch (z.B. "DDR-Info fehlt") |

**Query-Effizienz im Kurz-Modus**: Im Kurz-Modus werden nur die Header-Query und ein Aggregations-Count für Aufrufer/Aufgerufenes ausgeführt. Die teuren Detail-Queries (alle Schritte mit DDR_ScriptSteps, alle Field-Verwendungen mit Kommentaren, alle Lookup-Quellen) entfallen — das spart Laufzeit und Tokens beim Lesen der Tool-Ergebnisse.

**Identifikation läuft in beiden Modi gleich** — auch im Kurz-Modus muss das Objekt zuerst eindeutig sein (Schritt 1 ist unverzichtbar).

## Workflow

### Schritt 1 — Objekt identifizieren (BLOCKIEREND)

Bevor irgendeine Datenbankabfrage zur Beschreibung läuft, MUSS das zu beschreibende Objekt eindeutig sein.

**Eingabequellen für die Identifikation**:
1. Explizit übergebene UUID — direkt verwendbar
2. Explizit übergebener Name + (optional) Typ + (optional) Datei
3. Aus dem vorherigen Konversationskontext ableitbar (z.B. ein zuvor in einer Liste angezeigtes Objekt)

**Ablauf**:

1. **Wenn UUID vorliegt** → ObjectCatalog auflösen:
   ```sql
   SELECT Object_UUID, Object_Type, Object_Name, File_Name, Source_Table, Object_ID
   FROM ObjectCatalog
   WHERE Object_UUID = '<UUID>';
   ```
   Bei Treffer: weiter mit Schritt 2.
   Bei keinem Treffer: dem Benutzer mitteilen und nachfragen.

2. **Wenn nur ein Name vorliegt** → Suche im ObjectCatalog (case-insensitive, exakte Treffer bevorzugt):
   ```sql
   SELECT Object_UUID, Object_Type, Object_Name, File_Name, Source_Table
   FROM ObjectCatalog
   WHERE LOWER(Object_Name) = LOWER('<Name>')
   ORDER BY Object_Type, File_Name;
   ```
   - **0 Treffer**: LIKE-Fallback `LOWER(Object_Name) LIKE LOWER('%<Name>%')`. Wenn weiterhin nichts → Benutzer informieren, ähnliche Objekte vorschlagen, NICHT raten.
   - **Genau 1 Treffer**: weiter mit Schritt 2.
   - **>1 Treffer**: Liste aller Treffer (Typ, Name, Datei) ausgeben und Benutzer um Auswahl bitten. **NICHT** automatisch das erste Objekt nehmen.

3. **Wenn Kontext mehrdeutig ist** (z.B. der Benutzer sagt "beschreibe das Script" ohne klare Referenz): Nachfragen, welches Objekt gemeint ist. Lieber einmal zu viel fragen als das falsche Objekt beschreiben.

4. **Wenn Typ-Hint vorliegt** (z.B. "beschreibe das Layout 'Kunden'"): Filter `Object_Type = '<Type>'` ergänzen.

**Wichtig**: Erst nach eindeutiger Identifikation darf der typspezifische Beschreibungs-Workflow starten.

### Schritt 2 — Typspezifische Daten abrufen

Anhand von `Object_Type` den passenden Workflow wählen. Alle Queries verwenden `File_Name` UND die jeweilige Typ-UUID, weil Namen über Dateien hinweg nicht eindeutig sind.

#### Script

```sql
-- Header
SELECT * FROM ScriptCatalog WHERE Script_UUID = '<UUID>' AND File_Name = '<File>';

-- Schritte (DDR_ScriptSteps liefert lesbaren Text falls vorhanden)
SELECT
    s.Step_Index,
    s.Step_Name,
    s.Is_Enabled,
    s.Variable_Name,
    s.Calculation_Text,
    ddr.Step_Text  -- bevorzugt für Anzeige falls NOT NULL
FROM StepsForScripts s
LEFT JOIN DDR_ScriptSteps ddr
    ON s.DDR_UUID = ddr.Step_UUID
   AND s.File_Name = ddr.File_Name
WHERE s.Script_UUID = '<UUID>' AND s.File_Name = '<File>'
ORDER BY s.Step_Index;
```

Anschließend Abhängigkeiten via ObjectLinks (siehe Schritt 3). Relevante Link_Roles für Scripts:
- **Aufgerufen vom Script**: Source_UUID = Script-UUID, Link_Role IN (`calls_script`, `sets_field`, `navigates_to_field`, `navigates_to_layout`, `sets_variable`, `reads_variable`)
- **Wer ruft dieses Script auf**: Target_UUID = Script-UUID, Link_Role IN (`calls_script`, `triggers_script`, `trigger_script`)

Bei Scripts ist der Schritt-für-Schritt-Ablauf das Kernstück der Zusammenfassung. Jeden Schritt mit `Step_Index` durchnummerieren. Disabled Steps mit `(deaktiviert)` markieren.

#### Field

```sql
SELECT *
FROM FieldsForTables
WHERE Field_UUID = '<UUID>' AND File_Name = '<File>';
```

Auswertung der Spalten:
- **Basis**: `Field_Name`, `Table_Name`, `Field_Type` (Normal/Calculated/Summary), `Data_Type`, `Field_Comment`, `Is_Global`, `Max_Repetitions`
- **Calculated Field**: `Calculation_Text` (Klartext), `DDR_Hash` für JOIN auf DDR_Calculations
- **AutoEnter**: `AutoEnter_Type` bestimmt die anzuzeigenden Detailspalten
  - `Looked_up`: `Lookup_Field_Name`, `Lookup_TO_Name`, `Lookup_DontCopyIfEmpty`, `Lookup_NoMatchOption`
  - `Calculated`: `AE_Calc_Text`, `AE_Calc_Hash`, `AE_Calc_OverwriteExisting`, `AE_Calc_AlwaysEvaluate`
  - `ConstantData`: `AE_ConstantData`
  - `SerialNumber`, `CreationDate`, etc.: nur Typ ausweisen

Optional (wenn `DDR_Hash` oder `AE_Calc_Hash` vorhanden): Formel-Chunks aus DDR_Calculations:
```sql
SELECT Chunk_Index, Chunk_Type, Chunk_Content
FROM DDR_Calculations
WHERE Calc_Hash = '<DDR_Hash oder AE_Calc_Hash>'
  AND File_Name = '<File>'
ORDER BY Chunk_Index;
```

Verwendungen via ObjectLinks: `Target_UUID = Field-UUID` zeigt, wo das Feld benutzt wird (`displays_field`, `sets_field`, `lookup_source`, `left_field`/`right_field` in Relationships, `source_field` in ValueLists, etc.).

#### Layout

```sql
-- Layout selbst
SELECT L_ID, L_Name, L_TO_Name, File_Name FROM Layouts
WHERE L_UUID = '<UUID>' AND File_Name = '<File>';

-- Sektionen (Header/Body/Footer/...)
SELECT * FROM LayoutParts WHERE Layout_ID = <L_ID> AND File_Name = '<File>';

-- Objekt-Statistik (nicht alle Objekte einzeln auflisten — kann hunderte sein)
SELECT Object_Type, COUNT(*) AS Anzahl, MAX(Nesting_Level) AS Max_Tiefe
FROM LayoutObjects
WHERE Layout_ID = <L_ID> AND File_Name = '<File>'
GROUP BY Object_Type
ORDER BY Anzahl DESC;

-- Script-Trigger des Layouts
SELECT * FROM ScriptTriggers
WHERE Object_UUID = '<L_UUID>' AND File_Name = '<File>';
```

Über ObjectLinks ermitteln, welche Felder/Scripts/Wertelisten das Layout referenziert (Source_File = Layout-Datei, Source_Type = `LayoutObject`, parent_layout zeigt auf das Layout).

#### CustomFunction

```sql
SELECT * FROM CustomFunctionsCatalog
WHERE CF_UUID = '<UUID>' AND File_Name = '<File>';

SELECT Calculation_Code FROM CalcsForCustomFunctions
WHERE CF_UUID = '<UUID>' AND File_Name = '<File>';

-- Falls DDR_Hash vorhanden: Chunks mit aufgelösten Referenzen
SELECT Chunk_Index, Chunk_Type, Chunk_Content
FROM DDR_Calculations
WHERE Calc_Hash = '<DDR_Hash>' AND File_Name = '<File>'
ORDER BY Chunk_Index;
```

Verwendungen: ObjectLinks mit Target_UUID = CF-UUID zeigt, wer die CF aufruft.

#### ValueList

```sql
SELECT vl.*, o.Source_Type, o.Custom_Values, o.Field_Name, o.TO_Name
FROM ValueListCatalog vl
LEFT JOIN OptionsForValueLists o
    ON vl.VL_UUID = o.VL_UUID AND vl.File_Name = o.File_Name
WHERE vl.VL_UUID = '<UUID>' AND vl.File_Name = '<File>';
```

Verwendungen: ObjectLinks `Target_UUID = VL-UUID`, Link_Role `uses_valuelist` zeigt Layout-Objekte, die diese ValueList nutzen.

#### BaseTable

```sql
SELECT * FROM BaseTableCatalog WHERE BT_UUID = '<UUID>' AND File_Name = '<File>';

-- Felder
SELECT Field_Name, Field_Type, Data_Type, Is_Global, Field_Comment
FROM FieldsForTables WHERE Table_UUID = '<UUID>' AND File_Name = '<File>'
ORDER BY Field_ID;

-- Tabellen-Vorkommnisse
SELECT TO_Name, TO_ID FROM TableOccurrenceCatalog
WHERE BT_UUID = '<UUID>' AND File_Name = '<File>';
```

#### TableOccurrence

```sql
SELECT * FROM TableOccurrenceCatalog WHERE TO_UUID = '<UUID>' AND File_Name = '<File>';

-- Beziehungen, an denen dieses TO beteiligt ist
SELECT * FROM RelationshipCatalog
WHERE Left_TO_UUID = '<UUID>' OR Right_TO_UUID = '<UUID>'
  AND File_Name = '<File>';
```

#### Relationship

```sql
SELECT * FROM RelationshipCatalog WHERE Rel_ID = <ID> AND File_Name = '<File>';
```

Beziehungs-Predikate sind in den `Left_*` / `Right_*` Spalten enthalten, Operator in `Operator`.

#### Generischer Fallback (alle anderen Object_Types)

Wenn kein typspezifischer Workflow definiert ist:

```sql
-- Basisinfos
SELECT * FROM ObjectCatalog WHERE Object_UUID = '<UUID>';

-- Eingehende Verknüpfungen (was nutzt das Objekt)
SELECT Source_Type, Source_File, Link_Role,
       (SELECT Object_Name FROM ObjectCatalog WHERE Object_UUID = ol.Source_UUID) AS Source_Name
FROM ObjectLinks ol
WHERE Target_UUID = '<UUID>'
ORDER BY Source_Type;

-- Ausgehende Verknüpfungen (was nutzt das Objekt)
SELECT Target_Type, Target_File, Link_Role,
       (SELECT Object_Name FROM ObjectCatalog WHERE Object_UUID = ol.Target_UUID) AS Target_Name
FROM ObjectLinks ol
WHERE Source_UUID = '<UUID>'
ORDER BY Target_Type;
```

### Schritt 3 — Abhängigkeiten (für alle Typen)

Standard-Abfrage für eingehende und ausgehende Links. **Wichtig**: Nur `Link_Type = 'operational'` filtern, um strukturelles Hierarchie-Rauschen (parent_object, parent_layout, parent_script) auszublenden. Strukturelle Links nur einbeziehen, wenn sie für den Objekttyp inhaltlich relevant sind.

```sql
-- Was dieses Objekt verwendet (ausgehend)
SELECT
    ol.Link_Role,
    ol.Target_Type,
    oc.Object_Name AS Target_Name,
    ol.Target_File,
    ol.Is_Cross_File
FROM ObjectLinks ol
LEFT JOIN ObjectCatalog oc ON ol.Target_UUID = oc.Object_UUID
WHERE ol.Source_UUID = '<UUID>'
  AND ol.Link_Type = 'operational'
ORDER BY ol.Link_Role, oc.Object_Name;

-- Wer dieses Objekt verwendet (eingehend)
SELECT
    ol.Link_Role,
    ol.Source_Type,
    oc.Object_Name AS Source_Name,
    ol.Source_File,
    ol.Is_Cross_File
FROM ObjectLinks ol
LEFT JOIN ObjectCatalog oc ON ol.Source_UUID = oc.Object_UUID
WHERE ol.Target_UUID = '<UUID>'
  AND ol.Link_Type = 'operational'
ORDER BY ol.Link_Role, oc.Object_Name;
```

### Schritt 4 — Markdown-Zusammenfassung erzeugen

**Im Kurz-Modus** (`--short` oder Trigger-Wort): Direkt zum Abschnitt "Kurz-Modus-Output" am Ende dieses Schritts springen. Die ausführliche Sektion-Struktur unten gilt nur für den Standard-Modus.

Die Standard-Ausgabe folgt diesem Schema. Abschnitte ohne Inhalt weglassen.

```markdown
## <Objekt_Typ>: <Name>

**Datei**: <File_Name>
**UUID**: `<Object_UUID>`
**Interne ID**: <Object_ID> (falls relevant)

### Zweck
<Aus Field_Comment / sonstigen Kommentaren, oder kurze Ableitung aus Name + Kontext.
Falls kein Kommentar vorhanden: "Kein Kommentar im Objekt hinterlegt." und Hinweis,
dass der Zweck aus dem Verhalten abgeleitet wurde.>

### Technische Details
<Typspezifisch — siehe unten>

### Ablauf  *(nur bei Scripts)*
1. **<Step_Name>** — <DDR_Step_Text falls vorhanden, sonst Step_Name + Calculation_Text>
2. ...
   *(deaktivierte Schritte mit `(deaktiviert)` markieren)*

### Verwendet
<Liste der Objekte, die dieses Objekt aufruft / referenziert, gruppiert nach Link_Role>
- **calls_script**: ScriptA, ScriptB
- **sets_field**: Tabelle::Feld
- ...

### Wird verwendet von
<Liste der Objekte, die dieses Objekt aufrufen / referenzieren>
- **LayoutObject** (displays_field): Layout "Kunden"
- ...

### Hinweise
<Optional: Auffälligkeiten, z.B. Cross-File-Links, sehr viele Verwendungen, fehlende Kommentare,
deaktivierte Schritte, ungewöhnliche Konstruktionen>
```

**Format-Regeln (Standard-Modus)**:
- Markdown-Tabellen nur, wenn sie wirklich Mehrwert haben (>5 Zeilen, mehrere Spalten)
- Bei sehr langen Listen (>20 Einträge): zusammenfassen ("12 weitere Felder ...") und auf Nachfrage Details liefern
- Alle Bezeichner in der Originalsprache der FileMaker-Lösung lassen
- Bei Scripts: Bei vorhandenem `DDR_ScriptSteps.Step_Text` IMMER den lesbaren Text bevorzugen — er enthält aufgelöste Feldnamen, Variableninhalte und Parameter

#### Kurz-Modus-Output (`--short`)

Im Kurz-Modus entfällt die obige Sektions-Struktur komplett. Stattdessen: **1-2 Absätze Fließtext**, der die folgenden Fragen kompakt beantwortet:

1. **Was ist das Objekt?** — Typ, Name, Datei (inline, z.B. "Das Script **Faktura_RechnungDrucken** in der Datei `Rechnungen`")
2. **Was tut es?** — 1-3 Sätze, Kern-Funktion in eigenen Worten
3. **(Optional) Wie ist es eingebunden?** — höchstens 1 Halbsatz zu Aufrufern oder Sub-Aufrufen, NUR wenn es den Kontext wesentlich erhellt

**Verbote im Kurz-Modus**:
- Keine Markdown-Header (`##`, `###`)
- Keine Listen, keine Aufzählungen
- Keine Tabellen
- Keine Code-Blöcke
- Keine UUID-Anzeige (technische Detail-Information gehört in den Standard-Modus)
- Kein "Ablauf" (auch nicht verkürzt)

**Reduzierte Query-Liste im Kurz-Modus**:

| Object_Type | Standard-Modus Queries | Kurz-Modus Queries |
|-------------|------------------------|---------------------|
| Script | ScriptCatalog + StepsForScripts + DDR_ScriptSteps + alle ObjectLinks | Nur ScriptCatalog + COUNT(*) Aufrufer + COUNT(*) Sub-Calls |
| Field | FieldsForTables + DDR_Calculations + alle Verwendungen | Nur FieldsForTables (Field_Comment + Field_Type + AutoEnter_Type) |
| Layout | Layouts + LayoutParts + LayoutObjects-Aggregation + Trigger | Nur Layouts + COUNT(*) der LayoutObjects |
| CustomFunction | CustomFunctionsCatalog + CalcsForCustomFunctions + DDR + Aufrufer | Nur CustomFunctionsCatalog + COUNT(*) Aufrufer |
| Sonstige | Typ-spezifische Queries + ObjectLinks bidirektional | Nur ObjectCatalog-Eintrag + COUNT(*) eingehende/ausgehende Links |

**Beispiel-Output (Kurz-Modus, Script)**:

> Das Script **Faktura_RechnungDrucken** in der Datei `Rechnungen` erzeugt eine PDF-Ausgabe einer einzelnen Rechnung am übergebenen Speicherort. Es wird von 2 Stellen aufgerufen (manuell aus der Rechnungs-Bearbeitung sowie aus der Stapelverarbeitung) und nutzt 2 Hilfs-Scripts.

**Beispiel-Output (Kurz-Modus, Field)**:

> Das Feld **Email** in der Tabelle `Kunden` ist ein Text-Feld mit AutoEnter Calculated `Lower(Self)`. Laut Field-Kommentar dient die Normalisierung der eindeutigen Vergleichbarkeit beim Email-Versand.

**Wenn der Kurz-Modus zu wenig Information liefert**: Am Ende des Fließtexts EINEN Hinweissatz anhängen wie *"Für die vollständigen Schritte und Abhängigkeiten `/fm-summarize <Name>` ohne `--short` aufrufen."*

### Schritt 5 — Ausgabe

Die Markdown-Zusammenfassung im Chat ausgeben. KEINE Datei schreiben (außer im Rahmen der unten beschriebenen geplanten Erweiterung).

## Wichtige Hinweise

- **DDR-Verfügbarkeit prüfen**: `SELECT Has_DDR_INFO FROM XMLMetadata WHERE Filename = '<File>';` Falls `False`, sind `DDR_ScriptSteps` und `DDR_Calculations` leer und liefern keine Klartext-Texte. In diesem Fall auf `Step_Name`, `Calculation_Text` und `Variable_Name` zurückfallen.
- **Multi-File**: Wenn das Objekt Cross-File-Abhängigkeiten hat (`Is_Cross_File = TRUE`), diese explizit hervorheben.
- **Performance**: Bei Layouts mit hunderten Objekten NICHT alle LayoutObjects einzeln auflisten — immer aggregieren.
- **Keine Spekulation**: Wenn die Daten unvollständig sind, das ehrlich vermerken statt zu vermuten.
- **Read vs. Write**: Diese Skill liest nur. Niemals UPDATE/INSERT/DELETE auf der Datenbank ausführen.
- **Reihenfolge der Aktionen**: Identifikation → Bestätigung (falls mehrdeutig) → typspezifische Queries → Abhängigkeiten → Ausgabe. Nicht abkürzen.

## Beispiele

### Beispiel 1: Eindeutiger Script-Name

**Benutzer**: "Beschreibe das Script 'Kunde anlegen'"

1. Suche im ObjectCatalog → 1 Treffer (Object_Type = `Script`, File_Name = `KundenDB`)
2. ScriptCatalog + StepsForScripts + DDR_ScriptSteps abfragen
3. ObjectLinks für eingehende/ausgehende Links abfragen
4. Markdown-Zusammenfassung mit nummeriertem Ablauf ausgeben

### Beispiel 2: Mehrdeutiger Name

**Benutzer**: "Was macht 'Suchen'?"

1. Suche im ObjectCatalog → 4 Treffer (1× Script in `KundenDB`, 1× Script in `RechnungenDB`, 1× CustomFunction in `KundenDB`, 1× Layout in `KundenDB`)
2. **Ausgabe an den Benutzer**:
   ```
   Es gibt mehrere Objekte mit dem Namen 'Suchen'. Welches meinst du?
   1. Script "Suchen" in KundenDB
   2. Script "Suchen" in RechnungenDB
   3. CustomFunction "Suchen" in KundenDB
   4. Layout "Suchen" in KundenDB
   ```
3. Erst nach Antwort des Benutzers mit Schritt 2 fortfahren.

### Beispiel 3: Kontextableitung

**Konversationskontext**: Eine vorherige Query hat fünf Felder gelistet, das letzte war `Kunden::Telefon` (UUID `abc-123`).

**Benutzer**: "Beschreibe das letzte Feld davon"

1. Aus dem Kontext UUID `abc-123` ableiten
2. Direkt mit FieldsForTables-Query starten (kein Nachfragen nötig)
3. AutoEnter-Spalten auswerten, ggf. DDR_Calculations einbinden
4. Verwendungen via ObjectLinks
5. Zusammenfassung ausgeben

### Beispiel 4: Kurz-Modus

**Benutzer**: "/fm-summarize Faktura_RechnungDrucken --short"
*(alternativ: "Beschreibe Faktura_RechnungDrucken kurz")*

1. Identifikation wie üblich → 1 Treffer (Script in `Rechnungen`)
2. **Reduzierte Queries**: Nur ScriptCatalog-Header + zwei COUNT(*)-Aggregationen über ObjectLinks (Aufrufer / Sub-Calls). KEINE Schritte, KEINE DDR_ScriptSteps, KEINE Field-Verwendungen.
3. **Output** (1-2 Absätze Fließtext, ohne Sektionen):

   > Das Script **Faktura_RechnungDrucken** in der Datei `Rechnungen` erzeugt eine PDF-Ausgabe einer einzelnen Rechnung. Es wird von 2 Stellen aufgerufen und ruft 2 Hilfs-Scripts auf.
   >
   > Für die vollständigen Schritte und Abhängigkeiten `/fm-summarize Faktura_RechnungDrucken` ohne `--short` aufrufen.

### Beispiel 5: Nicht gefunden

**Benutzer**: "Beschreibe das Script 'KundeAnlegenV2'"

1. Suche im ObjectCatalog → 0 Treffer
2. LIKE-Fallback `%Kunde%anlegen%` → 1 Treffer: "KundeAnlegen"
3. **Ausgabe**: "Ein Script namens 'KundeAnlegenV2' existiert nicht. Meintest du eventuell 'KundeAnlegen'? Soll ich dieses beschreiben?"

## Geplante Erweiterungen (zukünftige Ausbaustufe)

> **Status**: Dokumentation only — nicht implementiert. Aktivierung erfolgt, wenn der Obsidian Vault eingerichtet ist.

Nach Erzeugung der Zusammenfassung soll der Skill den Benutzer fragen, ob die Beschreibung als Notiz zum FileMaker-Objekt gespeichert werden soll. Spezifikation:

- **Zielort**: Obsidian Vault, der alle Projektnotizen zur FileMaker-Lösung enthält. Pfad noch zu konfigurieren (vermutlich in einer projektlokalen Konfigurationsdatei oder Umgebungsvariable, z.B. `FM_OBSIDIAN_VAULT`).
- **Ablagestruktur**: Unterordner pro Objekt-Typ (`Scripts/`, `Fields/`, `Layouts/`, `CustomFunctions/`, …).
- **Dateinamen**: Müssen die Objekt-UUID enthalten, damit das Objekt eindeutig referenzierbar ist, auch wenn der FileMaker-Name sich ändert. Vorschlag: `<sanitized-name>__<uuid-short>.md`.
- **Update-Verhalten**: Bestehende Notizen werden NICHT überschrieben. Stattdessen wird die neue Zusammenfassung an die bestehende Datei angehängt (append) — typischerweise mit einem Trennabschnitt `## Update <Datum>`. Begründung: vom Benutzer manuell ergänzte Inhalte (z.B. Designentscheidungen, ToDos) sollen nicht verloren gehen. Vergleiche Memory `feedback_obsidian_updates`.
- **Frontmatter**: Beim ersten Erstellen einer Notiz YAML-Frontmatter mit `object_uuid`, `object_type`, `file_name`, `created_at` setzen.
- **Benutzerinteraktion**: Nach Ausgabe der Zusammenfassung im Chat fragen: "Soll ich diese Beschreibung im Obsidian Vault als Notiz zum Objekt speichern? (j/n)". Bei Ja: prüfen, ob bereits eine Notiz für die UUID existiert; entsprechend `create` oder `append`.

**TODOs vor Aktivierung**:
1. Konfigurationsmechanismus für Vault-Pfad festlegen
2. Append-Logik (Erkennung existierender Datei + Trennabschnitt) implementieren
3. Sanitizing-Funktion für Dateinamen aus FileMaker-Namen (Sonderzeichen, Leerzeichen)
4. Frontmatter-Schema mit dem Benutzer abstimmen
