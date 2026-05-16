# MBS Function Reference Skill

Dieser Skill ermöglicht Codex den Zugriff auf die offizielle Dokumentation des MonkeyBread Software (MBS) FileMaker Plugins über lokal gespeicherte HTML Dateien.

## Zweck

Das MBS Plugin für FileMaker bietet tausende zusätzliche Funktionen für FileMaker-Entwickler. Dieser Skill hilft bei der Analyse von FileMaker Scripts, die MBS Funktionen verwenden, indem er automatisch die offizielle Dokumentation abruft und kontextbezogene Erklärungen liefert.

## Verwendung

### Automatische Aktivierung

Der Skill wird automatisch aktiviert, wenn:
- Du nach einer MBS Funktion fragst
- Script-Analysen MBS Funktionen enthalten
- Du explizit fragst: "Erkläre mir die MBS Funktion X"

### Manuelle Aktivierung

```bash
# In Codex CLI
/skill mbs-function-reference MBS.SQL.Execute
```

### Beispiel-Anfragen

1. **Einzelne Funktion nachschlagen**:
   ```
   Was macht die Funktion MBS.SQL.Execute?
   ```

2. **Im Script-Kontext**:
   ```
   Analysiere das Script "Datenimport" und erkläre die verwendeten MBS Funktionen
   ```

3. **Best Practices**:
   ```
   Wie verwende ich MBS.Dialog.Alert richtig?
   ```

## Funktionsweise

1. Der Skill identifiziert MBS Funktionsnamen im Text oder in Script-Analysen
2. Er ruft die Dokumentation von `https://www.mbsplugins.eu/` ab
3. Die Dokumentation wird analysiert und strukturiert aufbereitet
4. Eine deutsche, kontextbezogene Erklärung wird generiert

## URL-Muster

Die MBS Dokumentation folgt diesem Muster:
```
https://www.mbsplugins.eu/component_<FunctionName>.shtml
```

Beispiele:
- `MBS.SQL.Execute` → `https://www.mbsplugins.eu/component_MBS-SQL-Execute.shtml`
- `FM.Dialog.Alert` → `https://www.mbsplugins.eu/component_FM-Dialog-Alert.shtml`

## Ausgabe

Der Skill liefert strukturierte Informationen:
- Funktionszweck und Beschreibung
- Syntax mit Parametern
- Rückgabewerte
- Verfügbarkeit (MBS Version, Plattformen)
- Beispielcode
- Best Practices und häufige Fehler

## Fehlerbehebung

### Dokumentation nicht gefunden
- Das Skill sollte automatisch die richtige Dokumentation im Projektverzeichnis unter `/docs/mbs` finden
- Falls nicht, prüfe die Schreibweise des Funktionsnamens

### Codex aktiviert den Skill nicht
- Verwende explizit "MBS" im Funktionsnamen
- Aktiviere den Skill manuell: `/skill mbs-function-reference`

## Erweiterungen

Du kannst den Skill erweitern für:
- Lokale Kopien der MBS Dokumentation
- Cached Dokumentations-Lookups
- Integration mit FileMaker DDR (Database Design Report)
- Automatische Code-Beispiele in FileMaker-Syntax

## Ressourcen

- [MBS Plugin Dokumentation](https://www.mbsplugins.eu/)
- [MBS Plugin Homepage](https://www.mbsplugins.com/)
- [Model Context Protocol](https://modelcontextprotocol.io/)

## Lizenz

Dieser Skill ist Teil des fm-lab Projekts.

