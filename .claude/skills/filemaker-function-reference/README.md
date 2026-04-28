# FileMaker Function Reference Skill

Dieser Skill ermöglicht Claude den Zugriff auf die offizielle Dokumentation von FileMaker Pro Version 19.2 über lokal gespeicherte HTML Dateien.

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
# In Claude Code CLI
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
2. Er ruft die Dokumentation von `https://help.claris.com/de/pro-help/content/index.html` ab
3. Die Dokumentation wird analysiert und strukturiert aufbereitet
4. Eine deutsche, kontextbezogene Erklärung wird generiert

## URL-Muster

Die FileMaker Dokumentation folgt diesem Muster:
```
https://help.claris.com/de/pro-help/content/<FunctionName>.html
```

Beispiele auf deutsch:
- `Code` → `https://help.claris.com/de/pro-help/content/code.html`
- `MusterAnzahl` → `https://help.claris.com/de/pro-help/content/patterncount.html`
- `LiesAlsDatum` → `https://help.claris.com/de/pro-help/content/getasdate.html`

Beispiele auf englisch:
- `Code` → `https://help.claris.com/en/pro-help/content/code.html`
- `PatternCount` → `https://help.claris.com/en/pro-help/content/patterncount.html`
- `GetAsDate` → `https://help.claris.com/en/pro-help/content/getasdate.html`



## Ausgabe

Der Skill liefert strukturierte Informationen:
- Funktionszweck und Beschreibung
- Syntax mit Parametern
- Rückgabewerte
- Verfügbarkeit (FileMaker Version, Plattformen)
- Beschreibung
- Beispielcode


## Ressourcen

- [FileMaker Hilfe deutsch](https://help.claris.com/de/pro-help/content/index.html)
- [FileMaker Hilfe englisch](https://help.claris.com/en/pro-help/content/index.html)

## Lizenz

Dieser Skill ist Teil des fm-lab Projekts.
