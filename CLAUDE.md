# FileMaker XML Analyse

## Rolle

Du bist ein Experte für FileMaker Lösungen. Du hilfst bei der Analyse und Entwicklung von FileMaker Anwendungen. Dazu hast Du Zugriff auf die Metadaten und Beschreibung aller Objekte in der vom Entwickler bearbeiteten Lösung.

## Der Kontext

FileMaker ist ein integriertes Entwicklungstool, welches über Datenbank, Benutzeroberfläche und Script-Engine verfügt. Über die Funktion SaveCopyAsXML kann die gesamte Anwendungsstruktur ohne die enthaltenen Nutzdaten exportiert werden. Pro FileMaker Datei wird eine XML-Datei erzeugt, in der ein Objektkatalog für alle Bestandteile der Anwendung enthalten ist.

Um den Zugriff auf die Teilbereiche des Objektkatalogs zu optimieren, konvertieren wir zunächst das XML in eine DuckDB Datenbank, wo für jeden Objekttyp eine eigene Tabelle bereit gestellt wird. Dies ermöglicht schnelle Abfragen aller Objekte und deren Beziehungen untereinander, da wir per SQL-Queries schnell und flexibel einen direkten Zugriff auf die benötigten Informationen erhalten können.


## XML-Struktur

**Unterstützte XML-Versionen:** SaXML v2.1.0.0+ (FileMaker 19+) mit Root-Element `<FMSaveAsXML>`. Das ältere Format SaXML v2.0.0.0 (FileMaker 18.x) mit Root-Element `<FMDynamicTemplate>` wird nicht unterstützt und automatisch mit einer Warnung übersprungen.

Eine Beschreibung der XML Struktur der FileMaker Datei findest Du im Dokument `docs/agents/xml-schema.md`.
Dies ist der Ausgangspunkt unserer Konvertierung. Anschließend liegen die für unsere Analyse relevanten Daten aus dem XML in den DuckDB Tabellen vor. Wir verwenden bei allen Analyseschritten ausschließlich die Daten aus der DuckDB Datenbank.



## Erzeugung der Datenbank

Für die Konvertierung der XML-Datei in die DuckDB Tabellen gibt es ein SQL-Template `sql/convert_xml.sql`. Dieses liest die einzelnen XML-Zweige mit der Beschreibung der FileMaker Objekte und erzeugt daraus eigenständige Tabellen.

Die Datenbank wird im Verzeichnis `db/` abgelegt. Der Dateiname lautet `fm_catalog.duckdb`.

**Datenbank erstellen:**
```bash
duckdb db/fm_catalog.duckdb < sql/convert_xml.sql
```

**Empfohlene Methode:** Verwende den Skill `convert-xml`:
- **Einzelne Datei**: `convert-xml "MyDatabase.xml"`
- **Alle Dateien (Batch)**: `convert-xml --batch`

Der Batch-Modus importiert automatisch alle XML-Dateien im `xml/` Verzeichnis und erstellt anschließend die Universal Catalogs.



## Verfügbare DuckDB Tabellen

Die Tabellennamen entsprechen den XML-Zweigen der jeweiligen Objekttypen. Insgesamt 30 Tabellen:

- **XMLMetadata** - Root-Attribute der XML-Datei (Version, DDR-Info Status)
- **ExternalDataSourceCatalog** - Externe Datenquellen
- **BaseTableCatalog** - Basis-Tabellen der FileMaker-Lösung
- **TableOccurrenceCatalog** - Tabellenvorkommnisse im Beziehungsdiagramm
- **RelationshipCatalog** - Beziehungen zwischen Tabellenvorkommnissen
- **FieldsForTables** - Felder aller Tabellen mit Typ, Eigenschaften und AutoEnter-Details (Lookup, Calculated, ConstantData)
- **CustomFunctionsCatalog** - Benutzerdefinierte Funktionen
- **CalcsForCustomFunctions** - Formeln der benutzerdefinierten Funktionen
- **ScriptCatalog** - Alle Scripts, Ordner und Separator
- **StepsForScripts** - Script-Schritte mit Parametern
- **Layouts** - Layouts der Lösung
- **LayoutObjects** - Alle Layoutobjekte aller Layouts (22 Typen, bis zu 4 Verschachtelungsebenen)
- **LayoutParts** - Layout Sektionen (Header, Datenteil, Footer)
- **ValueListCatalog** - Wertelisten
- **OptionsForValueLists** - Details zu Wertelisten (CustomValues, Feld-Referenzen)
- **AccountsCatalog** - Benutzerkonten
- **PrivilegeSetsCatalog** - Zugriffsberechtigungen
- **DDR_ScriptSteps** - Lesbare Script-Schritte (optional, nur wenn DDR-Info verfügbar)
- **DDR_Calculations** - Formel-Chunks für Abhängigkeitsanalyse (optional, nur wenn DDR-Info verfügbar)
- **PasteIndexList** - Liste von Object-IDs für Copy/Paste Operations
- **BaseDirectoryCatalog** - Basis Directory der FileMaker Datei
- **ScriptTriggers** - Script Trigger (OnFirstWindowOpen, OnLastWindowClose, etc.)
- **ExtendedPrivilegesCatalog** - Erweiterte Zugriffsberechtigungen (fmwebdirect, fmxdbc, fmapp, etc.)
- **CustomMenuCatalog** - Benutzerdefinierte Menüs mit verschachtelter Hierarchie
- **ThemeCatalog** - CSS Regelsätze für Layouts
- **FilesCatalog** - Metadaten aller importierten FileMaker-Dateien (Multi-File-Support)
- **ObjectCatalog** - Zentrale Objektverwaltung aller 25+ Objekttypen über alle Dateien
- **ObjectLinks** - Verknüpfungen zwischen Objekten (operational & structural, inkl. Cross-File-Links)
- **VariableUsages** - Jede einzelne Variablen-Verwendung mit Kontext (Script, Feld, Layout)
- **VariablesCatalog** - Aggregierte Übersicht pro Variable (Set/Read Counts, Scope, Dateien)


### Wichtige Spalten

Jede Tabelle enthält:
- Eine `ID` Spalte (z.B. `BT_ID`, `Script_ID`, `Field_ID`)
- Eine `Name` Spalte (z.B. `BT_Name`, `Script_Name`, `Field_Name`)
- Eine `UUID` Spalte für eindeutige Referenzierung

### FieldsForTables — AutoEnter-Spalten

Neben den Basis-Spalten (Table_ID/Name/UUID, Field_ID/Name/Type, Data_Type, Field_Comment, Field_UUID, Is_Global, Max_Repetitions, DDR_Hash, Calculation_Text) enthält FieldsForTables 13 zusätzliche Spalten für AutoEnter-Informationen:

**AutoEnter-Basisattribute (alle Typen):**
- `AutoEnter_Type` — Typ: `Looked_up`, `SerialNumber`, `Calculated`, `ConstantData`, `CreationDate`, etc. (NULL für Felder ohne AutoEnter)
- `AutoEnter_ProhibitMod` — Benutzer darf Wert überschreiben?

**Lookup-Details (nur AutoEnter_Type = 'Looked_up'):**
- `Lookup_Field_Name` / `Lookup_Field_UUID` — Quellfeld (Name und UUID)
- `Lookup_TO_Name` / `Lookup_TO_UUID` — Beziehungs-TO (Name und UUID)
- `Lookup_DontCopyIfEmpty` — Leerwerte nicht übernehmen?
- `Lookup_NoMatchOption` — `DoNotCopy` oder `ConstantData`

**AutoEnter Calculated-Details (nur AutoEnter_Type = 'Calculated'):**
- `AE_Calc_Text` — Klartext-Formel (komplementär zu `Calculation_Text` für echte Calculated Fields)
- `AE_Calc_Hash` — DDR-Hash (komplementär zu `DDR_Hash`, JOIN mit DDR_Calculations möglich)
- `AE_Calc_OverwriteExisting` — Vorhandene Werte überschreiben?
- `AE_Calc_AlwaysEvaluate` — Bei jeder Änderung neu berechnen?

**ConstantData (nur AutoEnter_Type = 'ConstantData'):**
- `AE_ConstantData` — Fester Standardwert

**Hinweis:** `Calculation_Text`/`DDR_Hash` sind für `fieldtype="Calculated"` (echte Calculated Fields), `AE_Calc_Text`/`AE_Calc_Hash` für `fieldtype="Normal"` mit AutoEnter-Berechnung. Ein Feld hat nie beide gleichzeitig gefüllt.

### LayoutObjects Struktur

Die **LayoutObjects** Tabelle enthält alle Layout-Objekte mit folgenden Schlüsselspalten:

**Basis-Attribute:**
- `Layout_ID` - Verknüpfung zum Layout (JOIN mit Layouts.L_ID)
- `Part_Type` - Layout-Sektion (Header, Body, Footer)
- `Object_ID` - Objekt-ID (nur innerhalb eines Layouts eindeutig)
- `Object_UUID` - Eindeutige UUID des Objekts
- `Object_Type` - Typ des Objekts (Text, Edit Box, Button, Portal, Rectangle, etc.)
- `Object_Name` - Benutzerdefinierter Name (oft leer)

**Positionierung:**
- `Bounds_Top`, `Bounds_Left`, `Bounds_Bottom`, `Bounds_Right` - Position und Größe in Pixeln

**Verschachtelung:**
- `Parent_Object_ID` - Verweis auf übergeordnetes Objekt (NULL = Top-Level)
- `Nesting_Level` - Verschachtelungsebene (0 = Top-Level, 1-4 = verschachtelt)

**Polymorphe Eigenschaften:**
- `Object_XML` - Vollständige Objektdefinition als rohes XML-Fragment (abfragbar per `xml_extract_text(Object_XML, '/xpath')[1]`)

**Objekt-Typen (22 verschiedene):**
- **Eingabe**: Edit Box, Drop-down List, Pop-up Menu, Radio Button Set, Checkbox Set, Drop-down Calendar
- **Anzeige**: Text, Graphic, Container, Web Viewer
- **Aktion**: Button, Grouped Button, Button Bar, Popover Button
- **Container**: Portal, Group, Tab Control, Panel, Slide Control, PopoverPanel
- **Grafik**: Rectangle, Line, Oval

### VariableUsages / VariablesCatalog

Der Variablen-Parser (integriert in `sql/create_universal_catalogs.sql`) extrahiert alle FileMaker-Variablen aus verschiedenen Quellen und erstellt zwei Tabellen:

**VariableUsages** — Jede einzelne Verwendung einer Variable:
- `Variable_Name` — Vollständiger Name inkl. Präfix (`$sort`, `$$Modul`)
- `Variable_Scope` — `global`, `local`, `superglobal`, `let_local`
- `Usage_Type` — `set` (Zuweisung) oder `read` (Lesezugriff)
- `Context_Type` — `script_step`, `calculation`, `auto_enter_calc`, `custom_function`, `layout_object`
- `Context_UUID`, `Context_Name` — UUID und Name des Kontexts
- `Script_Name`, `Script_UUID`, `Step_Index` — Script-Kontext
- `Table_Name`, `Field_Name` — Feld-Kontext
- `Source` — `set_variable_step`, `ddr_chunk`, `mbs_variable_call`, `merge_variable`, `regex_fallback`
- `File_Name` — FileMaker-Datei

**VariablesCatalog** — Aggregierte Übersicht pro Variable:
- `Variable_Name`, `Variable_Scope`, `Display_Name`, `Normalized_Name`
- `Set_Count`, `Read_Count`, `Script_Count`, `File_Count`
- `Files` (VARCHAR[]) — Liste der Dateinamen
- `Has_Spaces` — Leerzeichen im Namen?
- `Source_Reliability` — `ddr`, `mbs`, `merge`, `regex`

**Datenquellen:** DDR_Calculations VariableReference Chunks (primär), Set Variable Schritte, MBS Superglobale (Variable.Set/Get), Merge-Variables aus Layouts, LayoutObject-Formel-Hashes (Conditional Formatting, Hide, Tooltip, etc.), Regex-Fallback für Dateien ohne DDR.

**Präfix-Konvention für Display_Name:**
- `$` → local, `$$` → global, `$$$` → superglobal (synthetisch, MBS Plugin)

**ObjectCatalog-Integration:** Globale, lokale und superglobale Variablen werden als `GlobalVariable`, `LocalVariable`, `SuperglobalVariable` registriert. UUID = `md5(Variable_Name || '::' || File_Name)`.

**ObjectLinks-Rollen:** `sets_variable`, `reads_variable`, `displays_variable`


### DDR-Info Unterstützung (optional)

Ab FileMaker 21 kann beim Export die Option **"Include details for analysis tools"** aktiviert werden. Dies fügt detaillierte Metadaten hinzu.

**Prüfen ob DDR-Info verfügbar:**
```sql
SELECT Has_DDR_INFO, FileMaker_Version, Filename FROM XMLMetadata;
```

Die Tabellen **DDR_ScriptSteps** und **DDR_Calculations** werden immer erstellt, sind aber nur gefüllt, wenn `Has_DDR_INFO = 'True'`.

**Verwendung mit bedingter Anzeige:**
```sql
SELECT
    s.Script_Name,
    s.Step_Index,
    CASE WHEN (SELECT Has_DDR_INFO FROM XMLMetadata) = 'True'
         THEN ddr.Step_Text
         ELSE s.Step_Name END as Display_Text
FROM StepsForScripts s
LEFT JOIN DDR_ScriptSteps ddr ON s.DDR_UUID = ddr.Step_UUID;
```

#### DDR_Hash für Calculated Fields & CustomFunctions

Ab FileMaker 21+ mit DDR-Info enthalten **FieldsForTables** und **CustomFunctionsCatalog** eine `DDR_Hash` Spalte, die eine Verknüpfung zu **DDR_Calculations** ermöglicht.

**FieldsForTables:**
- `DDR_Hash` - Hash-Wert für Calculated Fields (NULL für andere Feldtypen)
- Ermöglicht JOIN mit `DDR_Calculations` über `DDR_Hash = Calc_Hash`

**CustomFunctionsCatalog:**
- `DDR_Hash` - Hash-Wert für CustomFunctions
- Wird von `CalcsForCustomFunctions.DDR_Hash` kopiert (automatisch via UPDATE)
- Ermöglicht JOIN mit `DDR_Calculations` über `DDR_Hash = Calc_Hash`

**Verwendung - Abhängigkeiten eines Calculated Fields:**
```sql
SELECT
    f.Field_Name,
    f.Table_Name,
    COUNT(d.Chunk_Index) as Dependency_Count
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.DDR_Hash = d.Calc_Hash
WHERE f.Field_Type = 'Calculated'
GROUP BY f.Field_Name, f.Table_Name
LIMIT 10;
```

**Verwendung - Abhängigkeiten einer CustomFunction:**
```sql
SELECT
    cf.CF_Name,
    COUNT(d.Chunk_Index) as Chunk_Count
FROM CustomFunctionsCatalog cf
JOIN DDR_Calculations d ON cf.DDR_Hash = d.Calc_Hash
GROUP BY cf.CF_Name
LIMIT 10;
```



### Universelle Kataloge

Die universellen Kataloge ermöglichen schnelle Cross-Reference-Analysen über alle Objekttypen und Dateien hinweg.

**FilesCatalog** - Metadaten aller importierten FileMaker-Dateien:
- `File_Name` - Dateiname ohne .fmp12 Suffix (PRIMARY KEY)
- `File_FullName` - Dateiname mit Suffix
- `File_UUID` - UUID der Datei aus XML
- `FileMaker_Version` - Version (z.B. "ProAdvanced 22.0.4")
- `Has_DDR_INFO` - DDR-Info verfügbar?
- `Import_Timestamp` - Zeitpunkt des Imports
- `XML_Path` - Pfad zur XML-Quelldatei

**ObjectCatalog** - Zentrale Objektverwaltung:
- `Object_UUID` - Eindeutige UUID des Objekts (PRIMARY KEY)
- `Object_Type` - Typ (Script, Field, Layout, LayoutObject, etc.)
- `Object_Name` - Name des Objekts
- `File_Name` - Dateiname der Quelldatei
- `Source_Table` - Ursprüngliche Tabelle (z.B. ScriptCatalog, FieldsForTables)
- `Object_ID` - Interne FileMaker ID

**Unterstützte Objekttypen:**
- BaseTable, TableOccurrence, Field, Relationship
- Script, ScriptStep, Layout, LayoutObject (22 Subtypen)
- CustomFunction, ValueList, Account, PrivilegeSet
- Theme, CustomMenu, ExtendedPrivilege, ScriptTrigger
- ExternalDataSource, BaseDirectory, LayoutPart

**ObjectLinks** - Verknüpfungen zwischen Objekten:
- `Source_UUID` / `Target_UUID` - Quell- und Ziel-Objekt UUIDs
- `Source_Type` / `Target_Type` - Objekttypen
- `Link_Type` - Art der Verknüpfung:
  - `operational` - Funktionale Abhängigkeiten (Script → Script, Script → Field, LayoutObject → Field, etc.)
  - `structural` - Container-Hierarchien (Portal → Child Objects, Tab Control → Panels, etc.)
- `Link_Role` - Spezifische Rolle (z.B. calls_script, displays_field, parent_layout)
- `Is_Cross_File` - Dateiübergreifende Verknüpfung?
- `Source_File` / `Target_File` - Dateinamen für Multi-File-Analysen

**Implementierte Link-Typen (31 gesamt):**
- Field → BaseTable (parent_table)
- Field → Field (lookup_source) — Lookup-Zielfeld verweist auf Quellfeld
- Field → TableOccurrence (lookup_relationship) — Lookup-Zielfeld nutzt diese Beziehung
- Field → Variable (reads_variable) — Calculated/AutoEnter-Formel referenziert Variable
- TableOccurrence → BaseTable (base_table)
- TableOccurrence → ExternalDataSource (data_source)
- Relationship → TableOccurrence (left_table, right_table)
- Relationship → Field (left_field, right_field)
- Layout → TableOccurrence (context_table)
- LayoutObject → Layout (parent_layout)
- LayoutObject → LayoutObject (parent_object, structural)
- LayoutObject → Field (displays_field)
- LayoutObject → Script (triggers_script)
- LayoutObject → ValueList (uses_valuelist) — Feld nutzt Werteliste
- LayoutObject → TableOccurrence (portal_context) — Portal-Datenquelle
- LayoutObject → Variable (displays_variable, reads_variable) — Merge-Variable, Trigger-Parameter, DDR-Formeln (Conditional, Hide, Tooltip, etc.)
- ScriptStep → Script (parent_script, structural)
- Script → Script (calls_script)
- Script → Field (sets_field, navigates_to_field)
- Script → Layout (navigates_to_layout) — Go to Layout Schritte
- Script → Variable (sets_variable, reads_variable) — Script setzt/liest Variable
- CustomFunction → Variable (reads_variable, sets_variable) — CF referenziert Variable
- ValueList → Field (source_field)
- ValueList → TableOccurrence (source_table)
- ScriptTrigger → Script (trigger_script)
- Account → PrivilegeSet (privilege_set)


## Zugriff auf die Objektdaten


### DB-Architektur (zwei Dateien)

Die Datenbank existiert in zwei getrennten Instanzen, um Schreib-/Lese-Konflikte zwischen `convert-xml`, der REST-API und Claude-Code-Analysen zu vermeiden:

| Datei | Zweck | Schreiben | Lesen |
|---|---|---|---|
| `db/fm_catalog.duckdb` (**Master**) | Single Source of Truth | `convert-xml` (ausschließlich) | Claude Code CLI (fm-summarize, fm-analyze, Ad-hoc-Queries) |
| `rest-api/db/fm_catalog.duckdb` (**Kopie**) | Lesekopie für den REST-API-Server | Sync-Hook in `convert_fm_xml.sh` | REST-API-Server (`READ_ONLY` Modus) |

**Wichtig für Claude-Code-Analysen:** Lies **immer** von `db/fm_catalog.duckdb` (Master). Die Kopie in `rest-api/db/` ist API-intern und kann zwischen einem `convert-xml`-Lauf und dem darauffolgenden Server-Reload kurzzeitig stale sein.

**Sync-Mechanismus:** Nach jedem erfolgreichen `convert-xml --batch` (oder Single-File-Import im Produktionsmodus) kopiert das Shell-Skript die Master-DB atomar nach `rest-api/db/fm_catalog.duckdb` und ruft anschließend `POST /api/admin/reload` auf. Der Server schließt seine DuckDB-Verbindung und öffnet sie neu — ohne Server-Neustart. Läuft der Server gerade nicht, ist das kein Fehler (Sync wird trotzdem durchgeführt, nur der Reload-Trigger wird ignoriert).

**Konfliktvermeidung:** DuckDB hält einen Datei-Lock auf der geöffneten DB. Da der Server im `READ_ONLY`-Modus auf eine *andere* Datei zugreift, bleibt die Master-DB frei beschreibbar. `convert-xml` und Claude-Code-CLI können parallel zum laufenden Server arbeiten.


### DuckDB-Kommandos für dieses Projekt

```bash
# Query ausführen
duckdb db/fm_catalog.duckdb -c "SELECT * FROM ScriptCatalog"

# Vorbereitete Queries ausführen
duckdb db/fm_catalog.duckdb < sql/list_all_scripts.sql
```


### SQL-Abfragen

Du verwendest DuckDB SQL Syntax, um auf die Objekt-Tabellen zuzugreifen:
- Jedes Objekt hat eine interne ID und eine UUID
- Für JOINS zwischen Tabellen verwende die UUID als Schlüssel
- Die Reihenfolge entspricht der FileMaker-Lösung
- Script-Schritte haben zusätzlich eine `Step_Index` Spalte für die korrekte Sortierung

### DuckDB Dokumentation als Referenz

Bei der Erstellung von komplexen SQL-Queries verwende den Skill `duckdb-skills:duckdb-docs` zur Recherche in der offiziellen DuckDB-Dokumentation. Nutze insbesondere:
- **DuckDB-spezifische Syntax**: `GROUP BY ALL`, `ORDER BY ALL`, `SELECT * EXCLUDE(...)`, `SELECT * REPLACE(...)`, `COLUMNS()`-Ausdruck
- **Effiziente Aggregation**: `arg_max()` / `arg_min()` statt komplexer Window-Funktionen, `QUALIFY` statt Subqueries
- **String- und List-Funktionen**: Function Chaining (`'text'.upper().replace(...)`), List Comprehensions, Slicing
- **Flexible Query-Struktur**: `FROM`-first Queries, `UNION BY NAME`, CTEs statt wiederholter Subqueries
- **XML-Zugriff**: `xml_extract_text(Object_XML, '/xpath')[1]` für polymorphe Attribute in LayoutObjects (erfordert `LOAD webbed;`)



## Beispiel-Queries


**Alle Scripts auflisten:**
```sql
SELECT
    Script_ID, Script_Name
FROM ScriptCatalog
WHERE (Folder_Type IS NULL OR Folder_Type = 'False')
  AND NOT Is_Separator
ORDER BY Script_Name;
```

**Felder einer Tabelle anzeigen:**
```sql
SELECT Field_Name, Field_Type, Data_Type
FROM FieldsForTables
WHERE Table_Name = 'IhrTabellenname'
ORDER BY Field_ID;
```

**LayoutObjects abfragen:**
```sql
-- Alle Objekte eines Layouts mit Verschachtelung
SELECT
    Object_Type,
    COUNT(*) as Count,
    MAX(Nesting_Level) as Max_Depth
FROM LayoutObjects
WHERE Layout_ID = 1065088
GROUP BY Object_Type
ORDER BY Count DESC;

-- Verschachtelte Objekte (z.B. in Portalen)
SELECT
    parent.Object_Type as Parent_Type,
    child.Object_Type as Child_Type,
    child.Bounds_Top,
    child.Bounds_Left
FROM LayoutObjects child
JOIN LayoutObjects parent ON child.Parent_Object_ID = parent.Object_ID
WHERE child.Layout_ID = 1065088
ORDER BY parent.Object_ID, child.Object_ID;

-- Objekte mit Layout-Namen
SELECT
    l.L_Name,
    o.Object_Type,
    COUNT(*) as Object_Count
FROM LayoutObjects o
JOIN Layouts l ON o.Layout_ID = l.L_ID
GROUP BY l.L_Name, o.Object_Type
ORDER BY l.L_Name, Object_Count DESC;
```


**Universelle Kataloge nutzen:**
```sql
-- Objekt-Existenz prüfen (über alle Objekttypen)
SELECT Object_Type, Object_Name, File_Name
FROM ObjectCatalog
WHERE Object_Name LIKE '%Import%'
ORDER BY Object_Type, File_Name;

-- Wo wird ein Field verwendet?
SELECT
    ol.Source_Type,
    oc_source.Object_Name as Verwendet_in,
    oc_source.File_Name as Datei,
    ol.Link_Role as Art
FROM ObjectCatalog oc_field
JOIN ObjectLinks ol ON oc_field.Object_UUID = ol.Target_UUID
JOIN ObjectCatalog oc_source ON ol.Source_UUID = oc_source.Object_UUID
WHERE oc_field.Object_Type = 'Field'
  AND oc_field.Object_Name LIKE '%Email%'
  AND ol.Link_Type = 'operational'
ORDER BY ol.Source_Type, oc_source.Object_Name;

-- Dateiübergreifende Abhängigkeiten
SELECT
    oc_source.File_Name as Von_Datei,
    oc_source.Object_Type as Typ,
    oc_source.Object_Name as Objekt,
    oc_target.File_Name as Nach_Datei,
    oc_target.Object_Name as Ziel_Objekt,
    ol.Link_Role
FROM ObjectLinks ol
JOIN ObjectCatalog oc_source ON ol.Source_UUID = oc_source.Object_UUID
JOIN ObjectCatalog oc_target ON ol.Target_UUID = oc_target.Object_UUID
WHERE ol.Is_Cross_File = TRUE
ORDER BY oc_source.File_Name, oc_source.Object_Type;

-- Welche Felder werden auf einem Layout angezeigt?
SELECT DISTINCT
    oc_field.Object_Name as Feldname,
    oc_field.File_Name as Feld_Datei,
    ol.Is_Cross_File as Dateiübergreifend
FROM ObjectCatalog oc_layout
JOIN ObjectLinks ol1 ON oc_layout.Object_UUID = ol1.Target_UUID
    AND ol1.Source_Type = 'LayoutObject'
    AND ol1.Link_Role = 'parent_layout'
JOIN ObjectLinks ol2 ON ol1.Source_UUID = ol2.Source_UUID
    AND ol2.Target_Type = 'Field'
    AND ol2.Link_Role = 'displays_field'
JOIN ObjectCatalog oc_field ON ol2.Target_UUID = oc_field.Object_UUID
WHERE oc_layout.Object_Type = 'Layout'
  AND oc_layout.Object_Name = 'IhrLayoutName'
ORDER BY oc_field.Object_Name;

-- Statistik: Objektanzahl pro Datei
SELECT
    Object_Type,
    File_Name,
    COUNT(*) as Anzahl
FROM ObjectCatalog
GROUP BY Object_Type, File_Name
ORDER BY Object_Type, File_Name;
```

Weitere Beispiele findest Du in der Datei `sql/sample_queries.sql`.


## Zusatzinformationen abrufen

Wenn der Entwickler nach MBS Funktionen fragt, verwende Deinen Skill `mbs-function-reference` um Beschreibungen zu den Funktionen abzufragen.

Wenn Du bei der Erstellung oder Optimierung von SQL-Queries unsicher bist, ob DuckDB eine bestimmte Funktion oder Syntax unterstützt, verwende den Skill `duckdb-skills:duckdb-docs` zur Recherche.



## Arbeitsablauf

1. **Frage analysieren**: Verstehe, welche FileMaker-Objekte relevant sind
2. **Passende Tabelle(n) identifizieren**: Wähle die richtige DuckDB-Tabelle
3. **Query erstellen**: Formuliere eine SQL-Abfrage (nutze sample_queries.sql als Vorlage)
4. **Query ausführen**: Führe die Query mit DuckDB aus
5. **Ergebnis aufbereiten**: Präsentiere das Ergebnis in verständlicher Form



## Unterstützte Aufgaben

Du unterstützt den Entwickler bei typischen Analyse-Schritten zu seiner FileMaker Anwendung:
- Fragen nach Objekt-Listen
- Fragen nach einzelnen Objekten, deren Bestandteilen und Verknüpfungen innerhalb der Anwendung
- Fragen zu Abhängigkeiten zwischen gleichen oder unterschiedlichen Objekten
- Fragen zu fehlenden Verknüpfungen oder verwaisten Objekten
- Fragen zum Kontext in dem ein Objekt verwendet wird
- Darstellung von Beziehungen in Form von Textlisten oder Mermaid-Diagrammen