# FileMaker Function Reference Skill

Dieser Skill ermöglicht Codex den Zugriff auf die offizielle Dokumentation der aktuell veröffentlichten Version von FileMaker Pro (Claris-Online-Hilfe). Die Dokumentation wird bevorzugt aus einem lokalen Cache geladen und nur dann online abgerufen, wenn kein passender Cache vorhanden ist.

## Zweck

FileMaker Pro ist eine Entwicklungsumgebung für individuelle Anwendungen. Dieser Skill hilft bei der Analyse von FileMaker Scripts, indem er automatisch die offizielle Dokumentation abruft und kontextbezogene Erklärungen für FileMaker Entwickler liefert.

## Verwendung

### Automatische Aktivierung

Der Skill wird automatisch aktiviert, wenn:
- Du nach einer FileMaker Funktion fragst
- Script-Analysen Befehle (Script-Schritte) enthalten, die erklärt werden sollen
- Formelfeld-Analysen oder CustomFunction-Analysen Funktionen enthalten, die erklärt werden sollen
- Du explizit fragst: "Erkläre mir die FileMaker Funktion X"

### Manuelle Aktivierung

```bash
# In Codex CLI
/skill filemaker-function-reference floor
```

### Beispiel-Anfragen

1. **Einzelne Funktion nachschlagen**:
   ```
   Was macht die Funktion floor?
   ```

2. **Im Formel-Kontext**:
   ```
   Analysiere die Berechnung im Feld "Individualpreis" und erkläre die verwendeten Funktionen
   ```

3. **Im Script-Kontext**:
   ```
   Analysiere das Script "Datenimport" und erkläre die verwendeten Script-Schritte
   ```

4. **Best Practices**:
   ```
   Wie verwende ich das Favoriten Fenster in FileMaker richtig?
   ```

## Funktionsweise

1. Der Skill identifiziert FileMaker Funktions-Namen und ScriptStep-Namen im Text oder in Script-Analysen
2. Er versucht zuerst, die Dokumentation aus dem lokalen Cache unter [docs/claris-help/](../../../docs/claris-help/) zu laden — in der vom Benutzer bevorzugten Sprache, mit Fallback auf Englisch
3. Falls kein lokaler Cache vorhanden ist (oder die gewünschte Sprache nicht installiert ist), wird die Online-Hilfe von `help.claris.com` abgerufen
4. Die Dokumentation wird analysiert und strukturiert aufbereitet
5. Eine kontextbezogene Erklärung in der Sprache des Benutzers wird generiert

## Dokumentationsquellen — Reihenfolge

### 1. Lokaler Cache (bevorzugt)

Der Skill prüft zunächst, ob die Claris-Online-Hilfe lokal gespiegelt wurde:

```
docs/claris-help/<lang>/content/<FunctionName>.html
```

Beispiele:
- `docs/claris-help/de/content/patterncount.html`
- `docs/claris-help/en/content/patterncount.html`

**Sprach-Fallback:** Ist die Datei in der bevorzugten Sprache nicht vorhanden, wird automatisch auf Englisch (`en`) zurückgegriffen — Englisch ist immer Teil der Installation (siehe Skill `install-claris-docs`).

**Prüfung:** Vor dem Online-Abruf prüft der Skill mit `ls docs/claris-help/<lang>/content/<slug>.html`, ob die Datei lokal verfügbar ist.

### 2. Online-Hilfe (Fallback)

Ist kein lokaler Cache vorhanden oder die gewünschte Funktion nicht gespiegelt, fällt der Skill auf die Online-Quelle zurück:

```
https://help.claris.com/<lang>/pro-help/content/<FunctionName>.html
```

Beispiele auf Deutsch:
- `Code` → `https://help.claris.com/de/pro-help/content/code.html`
- `MusterAnzahl` → `https://help.claris.com/de/pro-help/content/patterncount.html`
- `LiesAlsDatum` → `https://help.claris.com/de/pro-help/content/getasdate.html`

Beispiele auf Englisch:
- `Code` → `https://help.claris.com/en/pro-help/content/code.html`
- `PatternCount` → `https://help.claris.com/en/pro-help/content/patterncount.html`
- `GetAsDate` → `https://help.claris.com/en/pro-help/content/getasdate.html`

**Hinweis:** Die Slugs im Pfad sind sprachunabhängig immer englisch (z.B. `patterncount.html`, nicht `musteranzahl.html`).

## Verfügbare Sprachversionen

Die Claris-Online-Hilfe wird in 11 Sprachen angeboten. Englisch ist die Referenzsprache und immer verfügbar; weitere Sprachen können bei Bedarf lokal installiert werden.

| Code | Sprache               | Standardmäßig lokal | Hinweis                              |
|------|-----------------------|---------------------|--------------------------------------|
| `en` | Englisch              | immer               | Referenz, Fallback bei fehlendem Slug |
| `de` | Deutsch               | optional            | Empfohlen für deutschsprachige Devs  |
| `es` | Spanisch              | optional            |                                      |
| `fr` | Französisch           | optional            |                                      |
| `it` | Italienisch           | optional            |                                      |
| `nl` | Niederländisch        | optional            |                                      |
| `pt` | Portugiesisch         | optional            |                                      |
| `sv` | Schwedisch            | optional            |                                      |
| `ja` | Japanisch             | optional            |                                      |
| `ko` | Koreanisch            | optional            |                                      |
| `zh` | Chinesisch (vereinf.) | optional            | URL-Segment `zh` (nicht `zh-Hans`)   |

**Lokale Installation der Sprach-Sets:** Verwende den separaten Skill [`install-claris-docs`](../install-claris-docs/SKILL.md) zum Herunterladen weiterer Sprachen in `docs/claris-help/`. Englisch wird dabei stets mitinstalliert.

## Ausgabe

Der Skill liefert strukturierte Informationen:
- Funktionszweck und Beschreibung
- Syntax mit Parametern
- Rückgabewerte
- Verfügbarkeit (FileMaker Version, Plattformen)
- Beschreibung
- Beispielcode


## Ressourcen

- Lokaler Cache: [docs/claris-help/](../../../docs/claris-help/)
- Installations-Skill: [install-claris-docs](../install-claris-docs/SKILL.md)
- FileMaker Hilfe deutsch (online): [help.claris.com/de/pro-help/content/index.html](https://help.claris.com/de/pro-help/content/index.html)
- FileMaker Hilfe englisch (online): [help.claris.com/en/pro-help/content/index.html](https://help.claris.com/en/pro-help/content/index.html)

## Lizenz

Dieser Skill ist Teil des fm-lab Projekts.

