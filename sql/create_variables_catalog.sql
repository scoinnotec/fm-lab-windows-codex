-- ========================================
-- Variablen-Parser: VariableUsages + VariablesCatalog
-- ========================================
-- Erstellt persistente Tabellen für FileMaker-Variablen:
-- - VariableUsages: Jede einzelne Verwendung mit Kontext
-- - VariablesCatalog: Aggregierte Übersicht pro Variable
--
-- Datenquellen:
-- 1. DDR_Calculations VariableReference Chunks (primär)
-- 2. StepsForScripts Set Variable Schritte
-- 3. MBS Superglobale (Regex auf Calculation_Text)
-- 4. CustomFunction-Parameter
-- 5. Merge-Variables aus LayoutObjects
-- 6. Regex-Fallback für Dateien ohne DDR
--
-- Aufruf: duckdb db/fm_catalog.duckdb < sql/create_variables_catalog.sql
-- ========================================


-- ========================================
-- Tabelle 1: VariableUsages
-- Jede einzelne Verwendung einer Variable
-- ========================================

DROP TABLE IF EXISTS VariableUsages;

CREATE TABLE VariableUsages (
    Variable_Name VARCHAR NOT NULL,
    Variable_Scope VARCHAR NOT NULL,       -- global, local, superglobal, let_local, cf_parameter
    Usage_Type VARCHAR NOT NULL,           -- set, read
    Context_Type VARCHAR NOT NULL,         -- script_step, calculation, auto_enter_calc, custom_function, layout_object
    Context_UUID VARCHAR,
    Context_Name VARCHAR,
    Script_Name VARCHAR,
    Script_UUID VARCHAR,
    Step_Index INTEGER,
    Table_Name VARCHAR,
    Field_Name VARCHAR,
    Calc_Hash VARCHAR,
    Source VARCHAR NOT NULL,               -- set_variable_step, ddr_chunk, mbs_variable_call, cf_parameter, merge_variable, regex_fallback
    File_Name VARCHAR NOT NULL
);


-- ========================================
-- Schritt 1: Chunk_Type in DDR_Calculations materialisieren
-- (Aktuell immer NULL — Typ aus JSON extrahieren)
-- ========================================

UPDATE DDR_Calculations
SET Chunk_Type = json_extract_string(TRY_CAST(Chunk_Content AS JSON), '$.Chunk.@type')
WHERE Chunk_Type IS NULL
  AND Chunk_Content IS NOT NULL
  AND TRY_CAST(Chunk_Content AS JSON) IS NOT NULL;


-- ========================================
-- Schritt 2: DDR VariableReference Chunks → VariableUsages
-- Verknüpfung über Calc_Hash zu verschiedenen Kontexten
-- ========================================

-- 2a: Variablen in Calculated Fields (FieldsForTables.DDR_Hash)
INSERT INTO VariableUsages
SELECT
    json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') as Variable_Name,
    CASE
        WHEN json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') LIKE '$$%' THEN 'global'
        WHEN json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') LIKE '$%' THEN 'local'
        ELSE 'let_local'
    END as Variable_Scope,
    'read' as Usage_Type,
    'calculation' as Context_Type,
    f.Field_UUID as Context_UUID,
    f.Table_Name || '::' || f.Field_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    f.Table_Name,
    f.Field_Name,
    dc.Calc_Hash,
    'ddr_chunk' as Source,
    dc.File_Name
FROM DDR_Calculations dc
JOIN FieldsForTables f ON dc.Calc_Hash = f.DDR_Hash AND dc.File_Name = f.File_Name
WHERE dc.Chunk_Type = 'VariableReference'
  AND json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') IS NOT NULL;

-- 2b: Variablen in AutoEnter Calculated Fields (FieldsForTables.AE_Calc_Hash)
INSERT INTO VariableUsages
SELECT
    json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') as Variable_Name,
    CASE
        WHEN json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') LIKE '$$%' THEN 'global'
        WHEN json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') LIKE '$%' THEN 'local'
        ELSE 'let_local'
    END as Variable_Scope,
    'read' as Usage_Type,
    'auto_enter_calc' as Context_Type,
    f.Field_UUID as Context_UUID,
    f.Table_Name || '::' || f.Field_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    f.Table_Name,
    f.Field_Name,
    dc.Calc_Hash,
    'ddr_chunk' as Source,
    dc.File_Name
FROM DDR_Calculations dc
JOIN FieldsForTables f ON dc.Calc_Hash = f.AE_Calc_Hash AND dc.File_Name = f.File_Name
WHERE dc.Chunk_Type = 'VariableReference'
  AND f.AE_Calc_Hash IS NOT NULL
  AND json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') IS NOT NULL;

-- 2c: Variablen in CustomFunctions (CustomFunctionsCatalog.DDR_Hash)
INSERT INTO VariableUsages
SELECT
    json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') as Variable_Name,
    CASE
        WHEN json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') LIKE '$$%' THEN 'global'
        WHEN json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') LIKE '$%' THEN 'local'
        ELSE 'let_local'
    END as Variable_Scope,
    'read' as Usage_Type,
    'custom_function' as Context_Type,
    cf.CF_UUID as Context_UUID,
    cf.CF_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    dc.Calc_Hash,
    'ddr_chunk' as Source,
    dc.File_Name
FROM DDR_Calculations dc
JOIN CustomFunctionsCatalog cf ON dc.Calc_Hash = cf.DDR_Hash AND dc.File_Name = cf.File_Name
WHERE dc.Chunk_Type = 'VariableReference'
  AND cf.DDR_Hash IS NOT NULL
  AND json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') IS NOT NULL;

-- 2d: Variablen in Script-Schritt-Formeln
-- StepsForScripts.Parameters_XML enthält DDRREF-Hashes → DDR_Calculations.Calc_Hash
INSERT INTO VariableUsages
SELECT
    json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') as Variable_Name,
    CASE
        WHEN json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') LIKE '$$%' THEN 'global'
        WHEN json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') LIKE '$%' THEN 'local'
        ELSE 'let_local'
    END as Variable_Scope,
    'read' as Usage_Type,
    'script_step' as Context_Type,
    s.Script_UUID as Context_UUID,
    s.Script_Name as Context_Name,
    s.Script_Name,
    s.Script_UUID,
    s.Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    dc.Calc_Hash,
    'ddr_chunk' as Source,
    dc.File_Name
FROM DDR_Calculations dc
JOIN (
    SELECT
        Script_Name, Script_UUID, Step_Index, File_Name,
        unnest(regexp_extract_all(CAST(Parameters_XML AS VARCHAR), '"@hash":"([A-F0-9]{32})"', 1)) as calc_hash
    FROM StepsForScripts
    WHERE Parameters_XML IS NOT NULL
      AND CAST(Parameters_XML AS VARCHAR) LIKE '%DDRREF%'
) s ON dc.Calc_Hash = s.calc_hash AND dc.File_Name = s.File_Name
WHERE dc.Chunk_Type = 'VariableReference'
  AND json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') IS NOT NULL;

-- 2e: DDR-Variablen ohne zuordenbaren Kontext (Calc_Hash existiert in keiner der obigen Tabellen)
-- Diese werden trotzdem erfasst, um vollständige Abdeckung zu gewährleisten
INSERT INTO VariableUsages
SELECT
    json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') as Variable_Name,
    CASE
        WHEN json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') LIKE '$$%' THEN 'global'
        WHEN json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') LIKE '$%' THEN 'local'
        ELSE 'let_local'
    END as Variable_Scope,
    'read' as Usage_Type,
    'calculation' as Context_Type,
    NULL as Context_UUID,
    NULL as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    dc.Calc_Hash,
    'ddr_chunk' as Source,
    dc.File_Name
FROM DDR_Calculations dc
WHERE dc.Chunk_Type = 'VariableReference'
  AND json_extract_string(TRY_CAST(dc.Chunk_Content AS JSON), '$.Chunk.#text') IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM FieldsForTables f
      WHERE (dc.Calc_Hash = f.DDR_Hash OR dc.Calc_Hash = f.AE_Calc_Hash)
        AND dc.File_Name = f.File_Name
  )
  AND NOT EXISTS (
      SELECT 1 FROM CustomFunctionsCatalog cf
      WHERE dc.Calc_Hash = cf.DDR_Hash AND dc.File_Name = cf.File_Name
  )
  AND NOT EXISTS (
      SELECT 1 FROM StepsForScripts s
      WHERE s.Parameters_XML IS NOT NULL
        AND CAST(s.Parameters_XML AS VARCHAR) LIKE '%' || dc.Calc_Hash || '%'
        AND dc.File_Name = s.File_Name
  );


-- ========================================
-- Schritt 3: Set Variable Schritte → VariableUsages
-- ========================================

INSERT INTO VariableUsages
SELECT
    Variable_Name,
    CASE WHEN Variable_Name LIKE '$$%' THEN 'global' ELSE 'local' END as Variable_Scope,
    'set' as Usage_Type,
    'script_step' as Context_Type,
    Script_UUID as Context_UUID,
    Script_Name as Context_Name,
    Script_Name,
    Script_UUID,
    Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'set_variable_step' as Source,
    File_Name
FROM StepsForScripts
WHERE Step_Name = 'Set Variable'
  AND Variable_Name IS NOT NULL;


-- ========================================
-- Schritt 4: MBS Superglobale → VariableUsages
-- Regex auf Calculation_Text in allen formelführenden Spalten
-- ========================================

-- 4a: Variable.Set / FM.VariableSet in Script-Schritten
INSERT INTO VariableUsages
SELECT
    regexp_extract(Calculation_Text,
        '(?:FM\.VariableSet|Variable\.Set)\s*"\s*;\s*"([^"]+)"', 1) as Variable_Name,
    'superglobal' as Variable_Scope,
    'set' as Usage_Type,
    'script_step' as Context_Type,
    Script_UUID as Context_UUID,
    Script_Name as Context_Name,
    Script_Name,
    Script_UUID,
    Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'mbs_variable_call' as Source,
    File_Name
FROM StepsForScripts
WHERE Calculation_Text LIKE '%Variable.Set%' OR Calculation_Text LIKE '%FM.VariableSet%'
  AND regexp_extract(Calculation_Text,
        '(?:FM\.VariableSet|Variable\.Set)\s*"\s*;\s*"([^"]+)"', 1) IS NOT NULL;

-- 4b: Variable.Get / FM.VariableGet / Variable.Exists / Variable.Lookup in Script-Schritten
INSERT INTO VariableUsages
SELECT
    regexp_extract(Calculation_Text,
        '(?:FM\.VariableGet|Variable\.Get|Variable\.Exists|Variable\.Lookup)\s*"\s*;\s*"([^"]+)"', 1) as Variable_Name,
    'superglobal' as Variable_Scope,
    'read' as Usage_Type,
    'script_step' as Context_Type,
    Script_UUID as Context_UUID,
    Script_Name as Context_Name,
    Script_Name,
    Script_UUID,
    Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'mbs_variable_call' as Source,
    File_Name
FROM StepsForScripts
WHERE (Calculation_Text LIKE '%Variable.Get%'
    OR Calculation_Text LIKE '%FM.VariableGet%'
    OR Calculation_Text LIKE '%Variable.Exists%'
    OR Calculation_Text LIKE '%Variable.Lookup%')
  AND regexp_extract(Calculation_Text,
        '(?:FM\.VariableGet|Variable\.Get|Variable\.Exists|Variable\.Lookup)\s*"\s*;\s*"([^"]+)"', 1) IS NOT NULL;

-- 4c: Variable.Append / Variable.AppendValue / Variable.AppendJSON / Variable.Add in Script-Schritten
INSERT INTO VariableUsages
SELECT
    regexp_extract(Calculation_Text,
        '(?:Variable\.Append|Variable\.AppendValue|Variable\.AppendJSON|Variable\.Add)\s*"\s*;\s*"([^"]+)"', 1) as Variable_Name,
    'superglobal' as Variable_Scope,
    'set' as Usage_Type,
    'script_step' as Context_Type,
    Script_UUID as Context_UUID,
    Script_Name as Context_Name,
    Script_Name,
    Script_UUID,
    Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'mbs_variable_call' as Source,
    File_Name
FROM StepsForScripts
WHERE (Calculation_Text LIKE '%Variable.Append%'
    OR Calculation_Text LIKE '%Variable.AppendValue%'
    OR Calculation_Text LIKE '%Variable.AppendJSON%'
    OR Calculation_Text LIKE '%Variable.Add%')
  AND regexp_extract(Calculation_Text,
        '(?:Variable\.Append|Variable\.AppendValue|Variable\.AppendJSON|Variable\.Add)\s*"\s*;\s*"([^"]+)"', 1) IS NOT NULL;

-- 4d: Variable.Clear in Script-Schritten
INSERT INTO VariableUsages
SELECT
    regexp_extract(Calculation_Text,
        '(?:Variable\.Clear)\s*"\s*;\s*"([^"]+)"', 1) as Variable_Name,
    'superglobal' as Variable_Scope,
    'set' as Usage_Type,
    'script_step' as Context_Type,
    Script_UUID as Context_UUID,
    Script_Name as Context_Name,
    Script_Name,
    Script_UUID,
    Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'mbs_variable_call' as Source,
    File_Name
FROM StepsForScripts
WHERE Calculation_Text LIKE '%Variable.Clear%'
  AND Calculation_Text NOT LIKE '%Variable.ClearAll%'
  AND regexp_extract(Calculation_Text,
        '(?:Variable\.Clear)\s*"\s*;\s*"([^"]+)"', 1) IS NOT NULL;

-- 4e: MBS Superglobale in Calculated Fields (FieldsForTables.Calculation_Text)
INSERT INTO VariableUsages
SELECT
    regexp_extract(Calculation_Text,
        '(?:FM\.VariableGet|Variable\.Get|Variable\.Exists|Variable\.Lookup)\s*"\s*;\s*"([^"]+)"', 1) as Variable_Name,
    'superglobal' as Variable_Scope,
    'read' as Usage_Type,
    'calculation' as Context_Type,
    Field_UUID as Context_UUID,
    Table_Name || '::' || Field_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    Table_Name,
    Field_Name,
    NULL as Calc_Hash,
    'mbs_variable_call' as Source,
    File_Name
FROM FieldsForTables
WHERE Calculation_Text IS NOT NULL
  AND (Calculation_Text LIKE '%Variable.Get%'
    OR Calculation_Text LIKE '%FM.VariableGet%'
    OR Calculation_Text LIKE '%Variable.Exists%'
    OR Calculation_Text LIKE '%Variable.Lookup%')
  AND regexp_extract(Calculation_Text,
        '(?:FM\.VariableGet|Variable\.Get|Variable\.Exists|Variable\.Lookup)\s*"\s*;\s*"([^"]+)"', 1) IS NOT NULL;

-- 4f: MBS Superglobale in AutoEnter Calculated Fields (FieldsForTables.AE_Calc_Text)
INSERT INTO VariableUsages
SELECT
    regexp_extract(AE_Calc_Text,
        '(?:FM\.VariableGet|Variable\.Get|Variable\.Exists|Variable\.Lookup)\s*"\s*;\s*"([^"]+)"', 1) as Variable_Name,
    'superglobal' as Variable_Scope,
    'read' as Usage_Type,
    'auto_enter_calc' as Context_Type,
    Field_UUID as Context_UUID,
    Table_Name || '::' || Field_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    Table_Name,
    Field_Name,
    NULL as Calc_Hash,
    'mbs_variable_call' as Source,
    File_Name
FROM FieldsForTables
WHERE AE_Calc_Text IS NOT NULL
  AND (AE_Calc_Text LIKE '%Variable.Get%'
    OR AE_Calc_Text LIKE '%FM.VariableGet%'
    OR AE_Calc_Text LIKE '%Variable.Exists%'
    OR AE_Calc_Text LIKE '%Variable.Lookup%')
  AND regexp_extract(AE_Calc_Text,
        '(?:FM\.VariableGet|Variable\.Get|Variable\.Exists|Variable\.Lookup)\s*"\s*;\s*"([^"]+)"', 1) IS NOT NULL;

-- 4g: MBS Superglobale in CustomFunctions (CalcsForCustomFunctions.Calculation_Code)
INSERT INTO VariableUsages
SELECT
    regexp_extract(Calculation_Code,
        '(?:FM\.VariableGet|Variable\.Get|FM\.VariableSet|Variable\.Set|Variable\.Exists|Variable\.Lookup)\s*"\s*;\s*"([^"]+)"', 1) as Variable_Name,
    'superglobal' as Variable_Scope,
    CASE
        WHEN Calculation_Code LIKE '%Variable.Set%' OR Calculation_Code LIKE '%FM.VariableSet%' THEN 'set'
        ELSE 'read'
    END as Usage_Type,
    'custom_function' as Context_Type,
    CF_UUID as Context_UUID,
    CF_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'mbs_variable_call' as Source,
    File_Name
FROM CalcsForCustomFunctions
WHERE Calculation_Code IS NOT NULL
  AND (Calculation_Code LIKE '%Variable.Get%'
    OR Calculation_Code LIKE '%FM.VariableGet%'
    OR Calculation_Code LIKE '%Variable.Set%'
    OR Calculation_Code LIKE '%FM.VariableSet%'
    OR Calculation_Code LIKE '%Variable.Exists%'
    OR Calculation_Code LIKE '%Variable.Lookup%')
  AND regexp_extract(Calculation_Code,
        '(?:FM\.VariableGet|Variable\.Get|FM\.VariableSet|Variable\.Set|Variable\.Exists|Variable\.Lookup)\s*"\s*;\s*"([^"]+)"', 1) IS NOT NULL;


-- ========================================
-- Schritt 5: Merge-Variables aus LayoutObjects → VariableUsages
-- (Voraussetzung: Text_Content Spalte existiert in LayoutObjects)
-- ========================================

INSERT INTO VariableUsages
SELECT
    var_name as Variable_Name,
    CASE WHEN var_name LIKE '$$%' THEN 'global' ELSE 'local' END as Variable_Scope,
    'read' as Usage_Type,
    'layout_object' as Context_Type,
    lo.Object_UUID as Context_UUID,
    l.L_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'merge_variable' as Source,
    lo.File_Name
FROM LayoutObjects lo
JOIN Layouts l ON lo.Layout_ID = l.L_ID AND lo.File_Name = l.File_Name
CROSS JOIN LATERAL unnest(
    regexp_extract_all(lo.Text_Content, '<<(\$\$?[^>]+)>>', 1)
) as t(var_name)
WHERE lo.Object_Type = 'Text'
  AND lo.Text_Content LIKE '%<<%$%>>%';


-- ========================================
-- Schritt 6: CustomFunction-Parameter
-- HINWEIS: CF-Parameter werden NICHT in VariableUsages aufgenommen.
-- Sie haben nur Scope innerhalb der CF-Definition und erzeugen keine
-- sinnvollen Cross-References. (Siehe PRD Abschnitt 4.3)
-- ========================================


-- ========================================
-- Schritt 7: Regex-Fallback für Dateien ohne DDR
-- Nur für Dateien mit Has_DDR_INFO = 'False'
-- ========================================

-- 7a: Regex-Variablen aus Script-Schritt-Formeln (nur Dateien ohne DDR)
INSERT INTO VariableUsages
SELECT
    var_name as Variable_Name,
    CASE WHEN var_name LIKE '$$%' THEN 'global' ELSE 'local' END as Variable_Scope,
    'read' as Usage_Type,
    'script_step' as Context_Type,
    s.Script_UUID as Context_UUID,
    s.Script_Name as Context_Name,
    s.Script_Name,
    s.Script_UUID,
    s.Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'regex_fallback' as Source,
    s.File_Name
FROM StepsForScripts s
JOIN XMLMetadata m ON s.File_Name = m.Filename
CROSS JOIN LATERAL unnest(
    regexp_extract_all(s.Calculation_Text, '\$\$?[a-zA-Z_][a-zA-Z0-9_]*')
) as t(var_name)
WHERE m.Has_DDR_INFO = 'False'
  AND s.Calculation_Text IS NOT NULL
  AND s.Step_Name != 'Set Variable';

-- 7b: Regex-Variablen aus Calculated Fields (nur Dateien ohne DDR)
INSERT INTO VariableUsages
SELECT
    var_name as Variable_Name,
    CASE WHEN var_name LIKE '$$%' THEN 'global' ELSE 'local' END as Variable_Scope,
    'read' as Usage_Type,
    'calculation' as Context_Type,
    f.Field_UUID as Context_UUID,
    f.Table_Name || '::' || f.Field_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    f.Table_Name,
    f.Field_Name,
    NULL as Calc_Hash,
    'regex_fallback' as Source,
    f.File_Name
FROM FieldsForTables f
JOIN XMLMetadata m ON f.File_Name = m.Filename
CROSS JOIN LATERAL unnest(
    regexp_extract_all(f.Calculation_Text, '\$\$?[a-zA-Z_][a-zA-Z0-9_]*')
) as t(var_name)
WHERE m.Has_DDR_INFO = 'False'
  AND f.Calculation_Text IS NOT NULL;

-- 7c: Regex-Variablen aus AutoEnter Calculated Fields (nur Dateien ohne DDR)
INSERT INTO VariableUsages
SELECT
    var_name as Variable_Name,
    CASE WHEN var_name LIKE '$$%' THEN 'global' ELSE 'local' END as Variable_Scope,
    'read' as Usage_Type,
    'auto_enter_calc' as Context_Type,
    f.Field_UUID as Context_UUID,
    f.Table_Name || '::' || f.Field_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    f.Table_Name,
    f.Field_Name,
    NULL as Calc_Hash,
    'regex_fallback' as Source,
    f.File_Name
FROM FieldsForTables f
JOIN XMLMetadata m ON f.File_Name = m.Filename
CROSS JOIN LATERAL unnest(
    regexp_extract_all(f.AE_Calc_Text, '\$\$?[a-zA-Z_][a-zA-Z0-9_]*')
) as t(var_name)
WHERE m.Has_DDR_INFO = 'False'
  AND f.AE_Calc_Text IS NOT NULL;


-- ========================================
-- Schritt 8: Duplikate entfernen
-- DDR-Chunks können mehrfach den gleichen Variablennamen im selben
-- Kontext referenzieren — für den Catalog zählen wir distinct Usages
-- ========================================

-- Keine Deduplizierung auf VariableUsages-Ebene nötig:
-- Mehrere Referenzen derselben Variable im selben Script-Schritt/Feld
-- sind separate, gültige Usages (z.B. $var in IF und ELSE-Zweig)


-- ========================================
-- Tabelle 2: VariablesCatalog (Aggregation)
-- ========================================

DROP TABLE IF EXISTS VariablesCatalog;

CREATE TABLE VariablesCatalog AS
SELECT
    Variable_Name,
    Variable_Scope,
    -- Display_Name mit Scope-Präfix
    CASE Variable_Scope
        WHEN 'local' THEN Variable_Name
        WHEN 'global' THEN Variable_Name
        WHEN 'superglobal' THEN '$$$' || regexp_replace(Variable_Name, '^\$+', '')
        ELSE Variable_Name
    END as Display_Name,
    -- Normalized_Name ohne Präfix
    regexp_replace(Variable_Name, '^\$+', '') as Normalized_Name,
    COUNT(*) FILTER (WHERE Usage_Type = 'set') as Set_Count,
    COUNT(*) FILTER (WHERE Usage_Type = 'read') as Read_Count,
    COUNT(DISTINCT Script_Name) as Script_Count,
    COUNT(DISTINCT File_Name) as File_Count,
    array_agg(DISTINCT File_Name ORDER BY File_Name) as Files,
    first(Context_Name) as First_Seen_Context,
    Variable_Name LIKE '% %' as Has_Spaces,
    CASE WHEN bool_or(Source = 'ddr_chunk') THEN 'ddr'
         WHEN bool_or(Source = 'mbs_variable_call') THEN 'mbs'
         WHEN bool_or(Source = 'merge_variable') THEN 'merge'
         ELSE 'regex'
    END as Source_Reliability,
    mode(File_Name) as File_Name
FROM VariableUsages
GROUP BY Variable_Name, Variable_Scope;


-- ========================================
-- Indizes für Performance
-- ========================================

CREATE INDEX IF NOT EXISTS idx_varusages_name ON VariableUsages(Variable_Name);
CREATE INDEX IF NOT EXISTS idx_varusages_scope ON VariableUsages(Variable_Scope);
CREATE INDEX IF NOT EXISTS idx_varusages_context ON VariableUsages(Context_UUID);
CREATE INDEX IF NOT EXISTS idx_varusages_file ON VariableUsages(File_Name);
CREATE INDEX IF NOT EXISTS idx_varcatalog_scope ON VariablesCatalog(Variable_Scope);
CREATE INDEX IF NOT EXISTS idx_varcatalog_file ON VariablesCatalog(File_Name);


-- ========================================
-- Statistik ausgeben
-- ========================================

SELECT '=== Variablen-Parser Ergebnis ===' as Info;

SELECT
    Variable_Scope,
    COUNT(*) as Anzahl_Variablen,
    SUM(Set_Count) as Gesamt_Sets,
    SUM(Read_Count) as Gesamt_Reads,
    COUNT(*) FILTER (WHERE Has_Spaces) as Mit_Leerzeichen
FROM VariablesCatalog
GROUP BY ALL
ORDER BY Variable_Scope;

SELECT
    Source,
    COUNT(*) as Anzahl_Usages
FROM VariableUsages
GROUP BY Source
ORDER BY Anzahl_Usages DESC;

SELECT
    'Gesamt VariableUsages' as Metrik, COUNT(*)::VARCHAR as Wert FROM VariableUsages
UNION ALL
SELECT
    'Gesamt VariablesCatalog', COUNT(*)::VARCHAR FROM VariablesCatalog
UNION ALL
SELECT
    'Davon global', COUNT(*)::VARCHAR FROM VariablesCatalog WHERE Variable_Scope = 'global'
UNION ALL
SELECT
    'Davon lokal', COUNT(*)::VARCHAR FROM VariablesCatalog WHERE Variable_Scope = 'local'
UNION ALL
SELECT
    'Davon superglobal', COUNT(*)::VARCHAR FROM VariablesCatalog WHERE Variable_Scope = 'superglobal'
UNION ALL
SELECT
    'Davon let_local', COUNT(*)::VARCHAR FROM VariablesCatalog WHERE Variable_Scope = 'let_local'
;
