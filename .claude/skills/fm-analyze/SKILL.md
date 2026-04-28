---
name: fm-analyze
description: Analysiert die Business-Logik und den semantischen Zweck eines FileMaker-Objekts (Script, Field, Layout, CustomFunction, ValueList, etc.) aus der DuckDB-Datenbank `db/fm_catalog.duckdb`. Im Gegensatz zu fm-summarize (rein technische Beschreibung) betrachtet diese Analyse den Kontext: Variablen-Benennungen, Layout-Bezeichnungen, vor- und nachgelagerte Scripts in der Call-Chain, Trigger-Quellen, Feldkommentare verknüpfter Objekte. Daraus wird der vermutete fachliche Zweck abgeleitet und beschrieben. Unterstützt zwei Modi — Standard (vollständiger Bericht mit Call-Chain und semantischen Signalen) und Kurz (1-2 Absätze Fließtext, via `--short` Flag oder Trigger-Wörter wie "kurz", "knapp", "1-2 Sätze", "TL;DR"). Wird ausgelöst durch Anfragen wie "/fm-analyze", "analysiere Script X", "was ist der Zweck von X", "welche Business-Logik steckt hinter X", "erkläre den fachlichen Sinn von X".
---

# FileMaker Objekt-Analyse (Business-Logik)

Analysiere ein FileMaker-Objekt nicht nur technisch, sondern leite den **fachlichen Zweck** und die **Business-Logik** aus dem Kontext ab — Variablen-Namen, verbundene Scripts, Layout-Bezeichnungen, Feldkommentare, Auslöser und nachgelagerte Effekte.

## Abgrenzung zu fm-summarize

| Aspekt | fm-summarize | fm-analyze |
|--------|-------------|------------|
| Fokus | Was tut das Objekt technisch? | Warum existiert es fachlich? |
| Tiefe | Direktes Objekt + 1 Hop | Mehrere Hops (Call-Chain, Aufrufer-Aufrufer, ...) |
| Quellen | StepsForScripts, FieldsForTables, ObjectLinks | + Variablennamen, Layoutnamen, Feldkommentare verknüpfter Objekte, Trigger-Kontext |
| Ergebnis | Strukturierte Faktenliste | Narrative Beschreibung mit Schlussfolgerungen |
| Typische Frage | "Welche Schritte hat das Script?" | "Welche Geschäftslogik implementiert dieses Script?" |

**Faustregel**: Wenn der Benutzer wissen will, was das Objekt **macht** → fm-summarize. Wenn er wissen will, was das Objekt **bedeutet** oder **bezweckt** → fm-analyze.

Die beiden Skills schließen sich nicht aus: fm-analyze nutzt intern viele der gleichen Queries wie fm-summarize, wertet die Ergebnisse aber semantisch aus und erweitert sie um Kontext-Hops.

## Grundregeln

- **Sprache**: Deutsch
- **Datenbank**: `db/fm_catalog.duckdb` (DuckDB CLI, NICHT MotherDuck MCP)
- **Aufruf**: `duckdb db/fm_catalog.duckdb -c "<SQL>"` via Bash
- **Read-Only**: Niemals UPDATE/INSERT/DELETE
- **Vor jeder Analyse**: Objekt eindeutig identifizieren (siehe Schritt 1 — gleiche Regeln wie in fm-summarize)
- **Schlussfolgerungen kennzeichnen**: Was Faktum ist (aus DB) und was Interpretation ist (aus Benennung/Kontext) klar trennen. Interpretationen mit Wörtern wie "vermutlich", "deutet darauf hin", "spricht dafür" markieren.

## Ausgabe-Modi

Identisch zur Konvention in [fm-summarize](../fm-summarize/SKILL.md):

### Standard-Modus (Default)

Vollständiger Markdown-Bericht mit Vermuteter Zweck, Fachlicher Einordnung, Semantischen Signalen, Call-Chain (eingehend + ausgehend rekursiv), Berührten Objekten, Auffälligkeiten und offenen Fragen. Genaues Format siehe Schritt 5.

### Kurz-Modus (`--short`)

1-2 Absätze **Fließtext**, **keine** Markdown-Sektionen, **keine** Tabellen, **keine** Code-Blöcke. Enthält nur den Kern-Schluss der Analyse: was das Objekt fachlich tut und in welchem Modul es operiert.

**Aktivierung des Kurz-Modus**:

1. **Explizites Flag** (Position frei):
   ```
   /fm-analyze Faktura_RechnungDrucken --short
   /fm-analyze --short Faktura_RechnungDrucken
   ```

2. **Natürliche Sprache** — automatische Aktivierung bei Trigger-Wörtern in der Anfrage:
   - "kurz", "knapp", "knappe Analyse"
   - "1-2 Sätze", "in wenigen Sätzen"
   - "Kurzanalyse"
   - "TL;DR", "TLDR"
   - "grob", "überblicksartig"

**Modus-Unterschiede**:

| Sektion | Standard | `--short` |
|---------|----------|-----------|
| Header (Name, Typ, Datei, UUID) | ✓ | ✗ (nur inline im Fließtext) |
| Vermuteter Zweck | ✓ ausführlich | ✓ Kern (1-2 Sätze) |
| Fachliche Einordnung (Modul/Rolle/Auslöser) | ✓ als Liste | ✓ inline im Fließtext (1 Halbsatz) |
| Semantische Signale | ✓ als Liste | ✗ |
| Call-Chain (eingehend/ausgehend) | ✓ rekursiv mit Pfaden | ✗ (höchstens "wird von 3 Stellen aufgerufen") |
| Berührte Objekte (Tabelle) | ✓ | ✗ |
| Auffälligkeiten | ✓ | nur kritisch (z.B. "DDR-Info fehlt") |
| Offene Fragen | ✓ | ✗ |

**Reduzierte Query-Liste im Kurz-Modus**: Statt alle Kontext-Hops aus Schritt 3 abzufragen, reichen:
- Kerndaten des Objekts (Name, Kommentar, Typ)
- Aggregierte Aufrufer-/Aufgerufenes-Counts (1 Hop, kein rekursives CTE)
- Top-3 berührte Tabellen/Layouts als Modul-Hinweis
- KEINE rekursiven Call-Chains, KEINE per-Variable-Aggregation, KEINE Field-Comment-Joins

**Hedging bleibt Pflicht**: Auch im Kurz-Modus müssen Interpretationen mit "vermutlich" / "deutet darauf hin" / "spricht dafür" gekennzeichnet sein. Lieber kein Modul angeben als ein falsches.

**Identifikation läuft in beiden Modi gleich** — auch im Kurz-Modus muss das Objekt zuerst eindeutig sein (Schritt 1 ist unverzichtbar).

## Workflow

### Schritt 1 — Objekt identifizieren (BLOCKIEREND)

Identisch zu fm-summarize. Vor jeder weiteren Aktion MUSS das Objekt eindeutig sein:

1. UUID gegeben → direkt im ObjectCatalog auflösen.
2. Name gegeben → ObjectCatalog-Suche (case-insensitive). Bei mehreren Treffern Auswahlliste anbieten und auf Antwort warten. NICHT raten.
3. Kontextableitung erlaubt, wenn klar.

```sql
SELECT Object_UUID, Object_Type, Object_Name, File_Name, Source_Table, Object_ID
FROM ObjectCatalog
WHERE LOWER(Object_Name) = LOWER('<Name>')
ORDER BY Object_Type, File_Name;
```

### Schritt 2 — Kerndaten des Objekts laden

Je nach Object_Type die typspezifischen Basisdaten holen — die SQL-Templates aus [fm-summarize](../fm-summarize/SKILL.md) wiederverwenden. Hier reicht meist:

- **Script**: ScriptCatalog + StepsForScripts JOIN DDR_ScriptSteps (Step_Text bevorzugt)
- **Field**: FieldsForTables (inkl. Field_Comment, Calculation_Text, AE_Calc_Text)
- **Layout**: Layouts + LayoutParts + LayoutObjects (aggregiert)
- **CustomFunction**: CustomFunctionsCatalog + CalcsForCustomFunctions + DDR_Calculations

**Wichtig für fm-analyze**: Im Gegensatz zu fm-summarize ist hier der **Field_Comment** Goldstaub — wenn vorhanden, ist er die direkteste Quelle für den fachlichen Zweck. Auch Script-Kommentare im ersten Schritt (`Step_Type = 'Comment'`) sollten gelesen werden, da Entwickler Scripts oft mit einem Kopfkommentar dokumentieren.

### Schritt 3 — Semantische Signale sammeln (das Herzstück)

Über Schritt 2 hinaus die folgenden Kontext-Quellen abfragen. Welche relevant sind, hängt vom Object_Type ab.

#### 3a — Variablen-Semantik

Variablennamen sind oft sprechend (`$kundenID`, `$$Modul`, `$rechnungsdatum`). Über `VariableUsages` und `VariablesCatalog` herausfinden, welche Variablen das Objekt setzt/liest:

```sql
-- Welche Variablen werden in diesem Script gesetzt/gelesen?
SELECT
    Variable_Name,
    Variable_Scope,
    Usage_Type,
    Source,
    COUNT(*) AS Anzahl
FROM VariableUsages
WHERE Script_UUID = '<Script_UUID>' AND File_Name = '<File>'
GROUP BY ALL
ORDER BY Variable_Name, Usage_Type;
```

```sql
-- Wo wird eine spezifische Variable noch verwendet (gibt Hinweise auf Modulkontext)?
SELECT Context_Type, Context_Name, Script_Name, Usage_Type, File_Name
FROM VariableUsages
WHERE Variable_Name = '<$$Modul>'
ORDER BY Context_Type, Context_Name;
```

**Auswertung**: Sprechende Namen wie `$$AktuellerKunde`, `$rechnungsBetrag`, `$$IstAdmin` deuten auf den fachlichen Zweck. Globale Variablen (`$$`) zeigen oft Modul- oder Sitzungskontext an. Superglobale (`$$$` über MBS) deuten auf systemweite Konfigurationen hin.

#### 3b — Script-Call-Chain (rückwärts und vorwärts)

**Vorwärts** — was ruft dieses Script auf?

```sql
WITH RECURSIVE chain AS (
    -- Start: dieses Script
    SELECT
        ol.Source_UUID, ol.Target_UUID,
        oc_t.Object_Name AS Target_Name,
        oc_t.File_Name AS Target_File,
        1 AS Tiefe,
        oc_t.Object_Name AS Pfad
    FROM ObjectLinks ol
    JOIN ObjectCatalog oc_t ON ol.Target_UUID = oc_t.Object_UUID
    WHERE ol.Source_UUID = '<Script_UUID>'
      AND ol.Link_Role = 'calls_script'

    UNION ALL

    SELECT
        ol.Source_UUID, ol.Target_UUID,
        oc_t.Object_Name,
        oc_t.File_Name,
        c.Tiefe + 1,
        c.Pfad || ' → ' || oc_t.Object_Name
    FROM chain c
    JOIN ObjectLinks ol ON c.Target_UUID = ol.Source_UUID
    JOIN ObjectCatalog oc_t ON ol.Target_UUID = oc_t.Object_UUID
    WHERE ol.Link_Role = 'calls_script'
      AND c.Tiefe < 5  -- Tiefenbegrenzung gegen Zyklen
)
SELECT DISTINCT Tiefe, Target_Name, Target_File, Pfad FROM chain
ORDER BY Tiefe, Target_Name;
```

**Rückwärts** — wer ruft dieses Script auf? (analog mit umgekehrter Richtung)

```sql
WITH RECURSIVE callers AS (
    SELECT
        ol.Source_UUID,
        oc_s.Object_Name AS Source_Name,
        oc_s.File_Name AS Source_File,
        1 AS Tiefe,
        oc_s.Object_Name AS Pfad
    FROM ObjectLinks ol
    JOIN ObjectCatalog oc_s ON ol.Source_UUID = oc_s.Object_UUID
    WHERE ol.Target_UUID = '<Script_UUID>'
      AND ol.Link_Role = 'calls_script'

    UNION ALL

    SELECT
        ol.Source_UUID,
        oc_s.Object_Name,
        oc_s.File_Name,
        c.Tiefe + 1,
        oc_s.Object_Name || ' → ' || c.Pfad
    FROM callers c
    JOIN ObjectLinks ol ON c.Source_UUID = ol.Target_UUID
    JOIN ObjectCatalog oc_s ON ol.Source_UUID = oc_s.Object_UUID
    WHERE ol.Link_Role = 'calls_script'
      AND c.Tiefe < 5
)
SELECT DISTINCT Tiefe, Source_Name, Source_File, Pfad FROM callers
ORDER BY Tiefe, Source_Name;
```

**Auswertung**: Die rückwärts-Chain (Aufrufer) verrät den fachlichen Anlass: "Wird von 'Rechnung erstellen' aufgerufen" → das Script gehört zur Faktura. Die vorwärts-Chain zeigt, welche weiteren fachlichen Bausteine angefasst werden.

**Tiefenbegrenzung**: max. 5 Hops, sonst explodiert die Ausgabe. Bei hohem Verzweigungsgrad ggf. nur die unmittelbaren Nachbarn mit Beispielpfaden zeigen.

#### 3c — Trigger-Quellen (Layout-Trigger, Script-Trigger, LayoutObject-Trigger)

Wenn das Script über einen Trigger statt einen direkten Aufruf gestartet wird, ist der Trigger-Kontext entscheidend für die Bedeutung:

```sql
-- Eingehende Trigger-Links
SELECT ol.Link_Role, ol.Source_Type,
       oc.Object_Name AS Trigger_Source, oc.File_Name
FROM ObjectLinks ol
JOIN ObjectCatalog oc ON ol.Source_UUID = oc.Object_UUID
WHERE ol.Target_UUID = '<Script_UUID>'
  AND ol.Link_Role IN ('triggers_script', 'trigger_script');
```

Falls die Tabelle `ScriptTriggers` eine direkte Verknüpfung zum Script-UUID enthält, zusätzlich:

```sql
SELECT * FROM ScriptTriggers WHERE File_Name = '<File>' LIMIT 5;
-- Schema vor Verwendung prüfen — Spalten variieren je nach Datenbank-Version
```

**Auswertung**: Trigger wie `OnRecordCommit` auf Layout "Rechnung" deuten auf eine Validierung oder Folgeaktion vor dem Speichern hin. `OnObjectExit` auf einem Eingabefeld deutet auf eine Berechnung nach Eingabe.

#### 3d — Berührte Felder und ihre Kommentare

Felder, die das Script setzt oder liest, plus deren Kommentare:

```sql
SELECT DISTINCT
    f.Table_Name,
    f.Field_Name,
    f.Field_Type,
    f.Field_Comment,
    ol.Link_Role
FROM ObjectLinks ol
JOIN ObjectCatalog oc ON ol.Target_UUID = oc.Object_UUID
JOIN FieldsForTables f ON oc.Object_UUID = f.Field_UUID
WHERE ol.Source_UUID = '<Script_UUID>'
  AND ol.Target_Type = 'Field'
  AND ol.Link_Role IN ('sets_field', 'navigates_to_field')
ORDER BY f.Table_Name, f.Field_Name;
```

**Auswertung**: Die Tabellennamen (`Kunden`, `Rechnungen`, `Lieferadressen`) zeigen, welche fachlichen Entitäten betroffen sind. Field_Comments — falls vorhanden — sind fachliche Beschreibungen aus erster Hand.

#### 3e — Berührte Layouts

Welche Layouts ruft das Script auf? Layoutnamen sind häufig sprechend.

```sql
SELECT DISTINCT
    l.L_Name AS Layout_Name,
    l.L_TO_Name AS Kontext_TO,
    l.File_Name
FROM ObjectLinks ol
JOIN Layouts l ON ol.Target_UUID = l.L_UUID
WHERE ol.Source_UUID = '<Script_UUID>'
  AND ol.Link_Role = 'navigates_to_layout';
```

**Auswertung**: Wenn ein Script auf "Rechnung_Druck" wechselt, ist der Druck-Workflow plausibel. Der `L_TO_Name` (Kontext-Tabellenvorkommnis) verrät die fachliche Datenbasis.

#### 3f — Tabellen-Kontext

Bei Felder/TOs/Relationships die Felder der zugehörigen Tabelle anschauen — die Feldnamen einer Tabelle zusammen ergeben oft das fachliche Modell:

```sql
SELECT Field_Name, Field_Type, Field_Comment
FROM FieldsForTables
WHERE Table_UUID = '<BT_UUID>' AND File_Name = '<File>'
ORDER BY Field_ID;
```

#### 3g — Bei CustomFunctions: Wer ruft sie auf?

```sql
SELECT
    oc.Object_Type,
    oc.Object_Name,
    oc.File_Name,
    ol.Link_Role
FROM ObjectLinks ol
JOIN ObjectCatalog oc ON ol.Source_UUID = oc.Object_UUID
WHERE ol.Target_UUID = '<CF_UUID>'
  AND ol.Link_Type = 'operational';
```

Die Aufrufer geben Hinweis darauf, in welchem fachlichen Bereich die Funktion operiert.

### Schritt 4 — Semantische Auswertung

Aus den gesammelten Signalen Schlussfolgerungen ableiten. **Vorgehen**:

1. **Namens-Heuristik**: Achte auf wiederkehrende Begriffe in Objekt-, Variablen-, Feld-, Tabellen- und Layoutnamen. Tauchen "Rechnung", "Faktura", "Invoice" mehrfach auf? → Rechnungswesen-Modul. "Kunde", "Customer", "Account"? → Stammdatenpflege.
2. **Aktions-Heuristik**: Welche Verben tauchen im Script-Namen und in den Step-Texten auf? `Anlegen`, `Erstellen`, `Drucken`, `Importieren`, `Validieren`, `Berechnen` — sie geben den primären Zweck vor.
3. **Datenfluss-Heuristik**: Liest das Script mehr als es schreibt → vermutlich Berechnung/Auswertung. Schreibt es mehr als es liest → vermutlich Anlage/Update. Wechselt Layouts → Navigationssteuerung.
4. **Trigger-Heuristik**: Wird das Script ausschließlich von einem Trigger aufgerufen → es ist eine Reaktion auf ein Ereignis, nicht ein vom Benutzer gestarteter Workflow.
5. **Modul-Zuordnung**: Aus den berührten Tabellen und Layouts das fachliche Modul ableiten (Faktura, CRM, Lager, Buchhaltung, Berechtigung, Stammdaten, Reporting, ...).
6. **Wiederverwendung erkennen**: Wird ein Script von vielen unterschiedlichen Aufrufern in unterschiedlichen Modulen genutzt → es ist eine Utility/Helper-Funktion. Wird es nur von einer einzigen Stelle aufgerufen → es ist ein spezifischer Workflow-Schritt.
7. **Inkonsistenzen markieren**: Wenn der Name etwas suggeriert, was die Implementation nicht widerspiegelt (z.B. Script "Kunde anlegen", das aber nur ein Layout wechselt), dies als Hinweis ausgeben.

**Trennung von Fakten und Interpretation**:
- Fakten: "Das Script ruft 4 Sub-Scripts auf und schreibt in die Felder Rechnungen::Status und Rechnungen::Bezahlt_am."
- Interpretation: "Diese Kombination spricht dafür, dass das Script den Zahlungseingang einer Rechnung verbucht."

### Schritt 5 — Markdown-Bericht erzeugen

**Im Kurz-Modus** (`--short` oder Trigger-Wort): Direkt zum Abschnitt "Kurz-Modus-Output" am Ende dieses Schritts springen. Die ausführliche Sektion-Struktur unten gilt nur für den Standard-Modus.

Standard-Format:

```markdown
## Analyse: <Object_Type> "<Name>"

**Datei**: <File_Name>
**UUID**: `<Object_UUID>`

### Vermuteter Zweck
<2-4 Sätze in eigener Sprache, was das Objekt fachlich bewirkt. Verwende Hedging
("vermutlich", "deutet darauf hin"), wenn die Schlussfolgerung nicht 100% sicher ist.>

### Fachliche Einordnung
- **Modul / Domäne**: <z.B. Faktura, CRM, Berechtigung — abgeleitet aus berührten Tabellen/Layouts/Variablen>
- **Rolle**: <z.B. Workflow-Hauptscript, Utility-Funktion, Validierung, Trigger-Reaktion, Druck-Vorbereitung>
- **Auslöser**: <Wie wird das Objekt typischerweise gestartet? Direkter Aufruf, Trigger, Button, Menü>

### Semantische Signale
- **Sprechende Variablen**: $$AktuellerKunde, $rechnungsBetrag → deuten auf Kunden-/Rechnungs-Kontext
- **Berührte Tabellen**: Kunden, Rechnungen, Rechnungspositionen → Faktura
- **Layouts**: "Rechnung_Bearbeitung", "Rechnung_Druck" → Druck-Workflow plausibel
- **Aufrufer**: Wird ausschließlich von "Faktura starten" aufgerufen → Schritt im Faktura-Workflow
- **Aufgerufene Sub-Scripts**: "Rechnungsnummer vergeben", "Steuern berechnen" → strukturierter Anlage-Workflow

### Call-Chain
**Eingehend** (wer ruft dieses Objekt auf):
\`\`\`
Faktura starten → Rechnung anlegen (dieses Script)
Stapelverarbeitung → Rechnung anlegen
\`\`\`

**Ausgehend** (was ruft dieses Objekt auf):
\`\`\`
Rechnung anlegen → Rechnungsnummer vergeben
                → Steuern berechnen → MwSt-Tabelle laden
                → Layout wechseln auf "Rechnung_Bearbeitung"
\`\`\`

### Berührte Objekte (Auswahl)
| Tabelle | Feld | Aktion | Kommentar im Feld |
|---------|------|--------|-------------------|
| Rechnungen | Status | sets_field | Workflow-Status der Rechnung |
| ... | ... | ... | ... |

### Auffälligkeiten / Hinweise
<Optional: Inkonsistenzen, fehlende Kommentare, ungewöhnliche Konstrukte, sehr breite
Wiederverwendung, deaktivierte Schritte, dead code, Cross-File-Abhängigkeiten>

### Offene Fragen
<Optional: Wenn die Analyse Lücken hinterlässt, die nur der Entwickler beantworten kann —
formuliere konkrete Rückfragen, statt zu spekulieren.>
```

**Format-Regeln (Standard-Modus)**:
- Maximal 1-2 Markdown-Tabellen pro Bericht (nur dort, wo sie wirklich Mehrwert bringen)
- Listen ab >15 Einträgen kürzen mit "(weitere X)"
- Code-Blöcke nur für Call-Chain-Pfade
- Hedging konsequent: "vermutlich", "deutet darauf hin", "spricht dafür" — niemals als Faktum behaupten, was nur eine Interpretation ist
- Bei Scripts ohne DDR-Info (Step_Text NULL) explizit erwähnen, dass die Analyse durch fehlende Klartexte begrenzt ist

#### Kurz-Modus-Output (`--short`)

Im Kurz-Modus entfällt die obige Sektions-Struktur komplett. Stattdessen: **1-2 Absätze Fließtext**, der die folgenden Fragen kompakt beantwortet:

1. **Was ist das Objekt fachlich?** — Typ, Name, Datei (inline) + 1-2 Sätze zum vermuteten Zweck
2. **In welchem Modul / welcher Domäne?** — höchstens 1 Halbsatz (z.B. "im Faktura-Modul")
3. **(Optional) Wie ist es eingebunden?** — höchstens 1 Halbsatz zur Aufruferklasse, NUR wenn es den fachlichen Zweck wesentlich erklärt

**Verbote im Kurz-Modus**:
- Keine Markdown-Header, keine Listen, keine Tabellen, keine Code-Blöcke
- Keine UUID-Anzeige
- Keine Call-Chain-Pfade
- Keine Aufzählung semantischer Signale
- Keine separate "Offene Fragen"-Sektion (offene Fragen ggf. als ein abschließender Halbsatz im Fließtext)

**Hedging bleibt Pflicht**: "Vermutlich", "spricht dafür", "deutet darauf hin" — Interpretationen müssen auch im Kurz-Modus als solche gekennzeichnet sein.

**Beispiel-Output (Kurz-Modus, Script)**:

> **Faktura_RechnungDrucken** (Datei `Rechnungen`) ist vermutlich der Druck-/PDF-Workflow für eine einzelne Rechnung im Faktura-Modul. Die berührten Tabellen (`Rechnungen`, `Rechnungspositionen`) und die Layout-Namen ("Rechnung_Druck", "Rechnung_PDF") sprechen dafür. Wird sowohl manuell aus der Rechnungsbearbeitung als auch aus einem Stapel-Workflow aufgerufen.

**Beispiel-Output (Kurz-Modus, Field)**:

> Das Feld **Email** in `Kunden` speichert vermutlich eine normalisierte (kleingeschriebene) Form der Email-Adresse zur eindeutigen Vergleichbarkeit — der Field-Kommentar bestätigt das. Die AutoEnter-Berechnung `Lower(Self)` und die Verwendung im Email-Versand-Workflow deuten auf den Stammdaten-/Kommunikations-Kontext hin.

**Wenn der Kurz-Modus zu wenig Information liefert**: Am Ende des Fließtexts EINEN Hinweissatz anhängen wie *"Für die vollständige Call-Chain und semantischen Signale `/fm-analyze <Name>` ohne `--short` aufrufen."*

### Schritt 6 — Ausgabe

Bericht im Chat ausgeben. Nicht in Dateien schreiben (außer im Rahmen der unten beschriebenen geplanten Erweiterung — diese ist identisch zu fm-summarize).

## Wichtige Hinweise

- **DDR-Verfügbarkeit**: Ohne DDR-Info (`XMLMetadata.Has_DDR_INFO = 'False'`) sind `DDR_ScriptSteps.Step_Text` und `DDR_Calculations.Chunk_Content` leer. Dann wird die semantische Analyse deutlich schwächer, weil aufgelöste Feld-/Variablen-Referenzen fehlen. Diese Limitation explizit im Bericht erwähnen.
- **Tiefenbegrenzung**: Recursive CTEs immer mit `c.Tiefe < 5` (oder kleiner) absichern, um Zyklen und Explosion zu vermeiden.
- **Performance**: Bei Scripts mit hunderten von berührten Feldern aggregieren statt einzeln auflisten.
- **Hedging ist Pflicht**: Diese Skill liefert Interpretationen. Als Interpretation kennzeichnen, was Interpretation ist. Falsche Sicherheit ist schlimmer als ehrliche Unsicherheit.
- **Generischer Fallback**: Für Object_Types ohne spezifischen Workflow (Theme, CustomMenu, Account, etc.) reicht oft der ObjectLinks-Hop-Out und die Auswertung der Aufrufer/Verwender, um den Zweck einzuordnen.
- **Skill-Komposition**: Wenn der Benutzer NUR die Schritte sehen will, statt einer Analyse — fm-summarize verwenden, nicht beide.

## Beispiele

### Beispiel 1: Script mit klarem Modul-Kontext

**Benutzer**: "Was ist der fachliche Zweck von 'Faktura_RechnungDrucken'?"

1. ObjectCatalog → 1 Treffer (Script in `Rechnungen.fmp12`)
2. Schritte laden, Variablen, berührte Felder, Layouts, Aufrufer
3. Erkenntnisse:
   - Berührte Tabellen: nur `Rechnungen`, `Rechnungspositionen`
   - Variablen: `$rechnungsID`, `$ausgabe_pdf_pfad`
   - Layouts: "Rechnung_Druck", "Rechnung_PDF"
   - Aufgerufene Sub-Scripts: "PDF speichern", "Drucken"
   - Aufrufer: Button auf "Rechnung_Bearbeitung", "Stapeldruck Rechnungen"
4. Schlussfolgerung: "Druck-/PDF-Ausgabe einer einzelnen Rechnung. Wird sowohl manuell aus der Rechnungs-Bearbeitung als auch aus einem Stapelverarbeitungs-Workflow aufgerufen."

### Beispiel 2: Script ohne aussagekräftige Namen

**Benutzer**: "/fm-analyze ScriptXYZ_Util_v2"

1. Identifikation OK
2. Schritte zeigen primär `Set Variable`, `Loop`, `Get(...)`-Ausdrücke
3. Berührte Felder: keine
4. Aufrufer: 23 verschiedene Scripts in 4 verschiedenen Dateien
5. Schlussfolgerung: "Vermutlich eine Utility-Funktion ohne fachliche Bindung — die hohe und breite Wiederverwendung deutet auf einen Helper hin (z.B. String-Verarbeitung, Datums-Berechnung, Plausibilitätsprüfung). Ohne sprechende Variablen oder Berührung von Datenfeldern lässt sich der genaue Zweck aus dem Kontext nicht ermitteln. Empfehlung: Schritt-für-Schritt-Code via `/fm-summarize` ansehen."

### Beispiel 3: Trigger-Reaktion auf Feld

**Benutzer**: "Analysiere das Feld 'Kunden::Email'"

1. FieldsForTables liefert: AutoEnter Calculated mit `AE_Calc_Text = "Lower(Self)"`, Field_Comment = "Email muss klein geschrieben sein für eindeutigen Vergleich"
2. ObjectLinks: Wird auf Layouts "Kunden_Bearbeitung" und "Kunden_Liste" angezeigt, von Script "Email_Versand" gelesen
3. Schlussfolgerung: "Speichert die Email-Adresse des Kunden in normalisierter (kleingeschriebener) Form. Der Field-Kommentar bestätigt: das dient der eindeutigen Vergleichbarkeit. Wird im Versand-Workflow aktiv genutzt."

### Beispiel 4: Mehrdeutiger Name

**Benutzer**: "Analysiere 'Init'"

1. ObjectCatalog → 7 Scripts namens "Init" in 7 verschiedenen Dateien
2. **Ausgabe**: Liste anbieten, fragen welches gemeint ist. Erst nach Antwort fortfahren.

## Geplante Erweiterungen (zukünftige Ausbaustufe)

> **Status**: Dokumentation only — nicht implementiert. Aktivierung erfolgt, wenn der Obsidian Vault eingerichtet ist. Spezifikation identisch zu fm-summarize.

Nach Erzeugung der Analyse soll der Skill den Benutzer fragen, ob der Bericht als Notiz zum FileMaker-Objekt im Obsidian Vault gespeichert werden soll.

- **Zielort**: Obsidian Vault mit allen Projektnotizen zur FileMaker-Lösung (Pfad noch zu konfigurieren)
- **Ablagestruktur**: Unterordner pro Object_Type
- **Dateinamen**: Müssen die Object_UUID enthalten (eindeutige Referenzierung auch bei Umbenennung in FileMaker)
- **Update-Verhalten**: Bestehende Notizen werden NIEMALS überschrieben — neue Analysen werden via Append (z.B. unter `## Analyse <Datum>`) angehängt. Begründung: vom Benutzer manuell ergänzte Inhalte (Designentscheidungen, Hintergründe, ToDos) müssen erhalten bleiben. Vergleiche Memory `feedback_obsidian_updates`.
- **Frontmatter**: YAML mit `object_uuid`, `object_type`, `file_name`, `created_at`, plus eine `analysis_versions`-Liste, die jede Analyse-Iteration vermerkt
- **Koexistenz mit fm-summarize**: Beide Skills schreiben in dieselbe Notizdatei pro Objekt. Unterschiedliche Sektionen (`## Technische Beschreibung` von fm-summarize vs. `## Analyse` von fm-analyze) im selben Dokument bündeln den gesamten Wissensstand pro Objekt an einem Ort.

**TODOs vor Aktivierung**:
1. Konfigurationsmechanismus für Vault-Pfad festlegen (gemeinsam mit fm-summarize)
2. Append-Logik (Erkennung existierender Datei + Trennabschnitt mit Datum)
3. Sanitizing für Dateinamen aus FileMaker-Namen (Sonderzeichen, Leerzeichen)
4. Frontmatter-Schema mit dem Benutzer abstimmen
5. Konvention klären: Wenn fm-summarize und fm-analyze beide Sektionen schreiben, wer entscheidet die Reihenfolge im Dokument?
