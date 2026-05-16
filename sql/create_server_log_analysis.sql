-- ============================================
-- create_server_log_analysis.sql
-- ============================================
-- FileMaker Server log analysis.
--
-- Purpose:
-- Keep imported TopCallStats.log rows in DuckDB and match them to imported
-- FileMaker fields/layouts where the Top Call target provides enough detail.
--
-- Source:
-- https://help.claris.com/en/server-help/content/monitor-top-call-log.html
-- TopCallStats.log is tab-delimited. The documented Target formats include:
-- - <filename>::Table(<tableID>)::Field definitions(<fieldID>)
-- - <filename>::Tabelle(<tableID>)::Felddefinitionen(<fieldID>)
-- - <filename>::Table(<tableID>) / <filename>::Tabelle(<tableID>)
-- - <filename>::Table(<tableID>)::<layout> / <filename>::Tabelle(<tableID>)::<layout>
-- - <filename>::Script(<scriptID>)
-- - <filename>::<layout>

CREATE TABLE IF NOT EXISTS ServerTopCallLogRaw (
    Log_File VARCHAR,
    Imported_At TIMESTAMP,
    Row_Number BIGINT,
    Timestamp_Text VARCHAR,
    Start_Time DOUBLE,
    End_Time DOUBLE,
    Total_Elapsed_Microseconds BIGINT,
    Operation VARCHAR,
    Target VARCHAR,
    Network_Bytes_In BIGINT,
    Network_Bytes_Out BIGINT,
    Elapsed_Time_Microseconds BIGINT,
    Wait_Time_Microseconds BIGINT,
    IO_Time_Microseconds BIGINT,
    Client_Name VARCHAR,
    Target_File_Name VARCHAR,
    Target_Table_ID BIGINT,
    Target_Field_ID BIGINT,
    Target_Layout_Name VARCHAR,
    Target_Script_ID BIGINT,
    Target_Kind VARCHAR
);

ALTER TABLE ServerTopCallLogRaw ADD COLUMN IF NOT EXISTS Target_Script_ID BIGINT;

DROP VIEW IF EXISTS ServerTopCallObjectMatches;
DROP VIEW IF EXISTS ServerTopCallOptimizationSummary;
DROP VIEW IF EXISTS ServerTopCallDashboard;

CREATE VIEW ServerTopCallObjectMatches AS
WITH layout_matches AS (
    SELECT
        r.*,
        l.L_UUID AS Object_UUID,
        'Layout' AS Object_Type,
        l.L_Name AS Object_Name,
        l.File_Name AS Object_File,
        l.L_TO_Name AS Related_TO_Name,
        NULL::VARCHAR AS Related_Table_Name,
        'layout_target' AS Match_Source,
        'high' AS Match_Confidence
    FROM ServerTopCallLogRaw r
    JOIN Layouts l
      ON lower(l.File_Name) = lower(r.Target_File_Name)
     AND lower(l.L_Name) = lower(r.Target_Layout_Name)
    WHERE r.Target_Kind = 'layout'
),
field_matches AS (
    SELECT
        r.*,
        f.Field_UUID AS Object_UUID,
        'Field' AS Object_Type,
        f.Field_Name AS Object_Name,
        f.File_Name AS Object_File,
        NULL::VARCHAR AS Related_TO_Name,
        f.Table_Name AS Related_Table_Name,
        'table_field_target' AS Match_Source,
        'high' AS Match_Confidence
    FROM ServerTopCallLogRaw r
    JOIN FieldsForTables f
      ON lower(f.File_Name) = lower(r.Target_File_Name)
     AND f.Table_ID = r.Target_Table_ID
     AND f.Field_ID = r.Target_Field_ID
    WHERE r.Target_Kind = 'field'
),
script_matches AS (
    SELECT
        r.*,
        s.Script_UUID AS Object_UUID,
        'Script' AS Object_Type,
        s.Script_Name AS Object_Name,
        s.File_Name AS Object_File,
        NULL::VARCHAR AS Related_TO_Name,
        NULL::VARCHAR AS Related_Table_Name,
        'script_target' AS Match_Source,
        'high' AS Match_Confidence
    FROM ServerTopCallLogRaw r
    JOIN ScriptCatalog s
      ON lower(s.File_Name) = lower(r.Target_File_Name)
     AND s.Script_ID = r.Target_Script_ID
    WHERE r.Target_Kind = 'script'
),
table_matches AS (
    SELECT
        r.*,
        b.BT_UUID AS Object_UUID,
        'BaseTable' AS Object_Type,
        b.BT_Name AS Object_Name,
        b.File_Name AS Object_File,
        NULL::VARCHAR AS Related_TO_Name,
        b.BT_Name AS Related_Table_Name,
        'table_target' AS Match_Source,
        'high' AS Match_Confidence
    FROM ServerTopCallLogRaw r
    JOIN BaseTableCatalog b
      ON lower(b.File_Name) = lower(r.Target_File_Name)
     AND b.BT_ID = r.Target_Table_ID
    WHERE r.Target_Kind = 'table'
),
matched_ids AS (
    SELECT Log_File, Row_Number FROM layout_matches
    UNION
    SELECT Log_File, Row_Number FROM field_matches
    UNION
    SELECT Log_File, Row_Number FROM script_matches
    UNION
    SELECT Log_File, Row_Number FROM table_matches
),
unmatched AS (
    SELECT
        r.*,
        NULL::VARCHAR AS Object_UUID,
        CASE r.Target_Kind
          WHEN 'field' THEN 'Field'
          WHEN 'script' THEN 'Script'
          WHEN 'table' THEN 'BaseTable'
          WHEN 'layout' THEN 'Layout'
          ELSE NULL
        END AS Object_Type,
        COALESCE(r.Target_Layout_Name, r.Target) AS Object_Name,
        r.Target_File_Name AS Object_File,
        NULL::VARCHAR AS Related_TO_Name,
        NULL::VARCHAR AS Related_Table_Name,
        'unmatched_target' AS Match_Source,
        'none' AS Match_Confidence
    FROM ServerTopCallLogRaw r
    LEFT JOIN matched_ids m
      ON m.Log_File = r.Log_File
     AND m.Row_Number = r.Row_Number
    WHERE m.Row_Number IS NULL
)
SELECT * FROM layout_matches
UNION ALL
SELECT * FROM field_matches
UNION ALL
SELECT * FROM script_matches
UNION ALL
SELECT * FROM table_matches
UNION ALL
SELECT * FROM unmatched;

CREATE VIEW ServerTopCallOptimizationSummary AS
WITH base AS (
    SELECT
        COALESCE(Object_Type, 'Unmatched') AS Object_Type,
        Object_UUID,
        COALESCE(Object_Name, Target, '(unknown target)') AS Object_Name,
        COALESCE(Object_File, Target_File_Name, '(unknown file)') AS File_Name,
        Related_TO_Name,
        Related_Table_Name,
        Match_Confidence,
        COUNT(*) AS Call_Count,
        SUM(COALESCE(Total_Elapsed_Microseconds, 0)) AS Total_Elapsed_Microseconds,
        MAX(COALESCE(Total_Elapsed_Microseconds, 0)) AS Max_Elapsed_Microseconds,
        SUM(COALESCE(Elapsed_Time_Microseconds, 0)) AS Interval_Elapsed_Microseconds,
        SUM(COALESCE(Wait_Time_Microseconds, 0)) AS Wait_Time_Microseconds,
        SUM(COALESCE(IO_Time_Microseconds, 0)) AS IO_Time_Microseconds,
        SUM(COALESCE(Network_Bytes_In, 0)) AS Network_Bytes_In,
        SUM(COALESCE(Network_Bytes_Out, 0)) AS Network_Bytes_Out,
        string_agg(DISTINCT Operation, ' | ' ORDER BY Operation) AS Operations,
        max(Timestamp_Text) AS Last_Seen_Text
    FROM ServerTopCallObjectMatches
    GROUP BY
        COALESCE(Object_Type, 'Unmatched'),
        Object_UUID,
        COALESCE(Object_Name, Target, '(unknown target)'),
        COALESCE(Object_File, Target_File_Name, '(unknown file)'),
        Related_TO_Name,
        Related_Table_Name,
        Match_Confidence
)
SELECT
    *,
    Total_Elapsed_Microseconds / 1000.0 AS Total_Elapsed_Milliseconds,
    Max_Elapsed_Microseconds / 1000.0 AS Max_Elapsed_Milliseconds,
    Wait_Time_Microseconds / 1000.0 AS Wait_Time_Milliseconds,
    IO_Time_Microseconds / 1000.0 AS IO_Time_Milliseconds,
    CASE
      WHEN Object_Type = 'Layout' THEN
        'Layout prüfen: Layoutobjekte, Portale, bedingte Formatierung, unstored Felder und Startscript-Kontext.'
      WHEN Object_Type = 'Field' AND IO_Time_Microseconds > Wait_Time_Microseconds THEN
        'Feld prüfen: Berechnung, Indexierung, unstored Abhängigkeiten und Tabellenbeziehung analysieren.'
      WHEN Object_Type = 'Field' THEN
        'Feld prüfen: Berechnung/Lookup/Auto-Enter und abhängige TOs analysieren.'
      WHEN Object_Type = 'Script' THEN
        'Script prüfen: Serverausführung, Schleifen, Suchen/Sortieren, Commit-Strategie und aufgerufene Subscripts analysieren.'
      WHEN Object_Type = 'BaseTable' THEN
        'Tabelle prüfen: Such-/Sortierkriterien, Indexe, Ergebnismengen, Portale und häufig betroffene Beziehungen analysieren.'
      WHEN Wait_Time_Microseconds > IO_Time_Microseconds AND Wait_Time_Microseconds > 0 THEN
        'Hohe Wait Time: mögliche Sperren, konkurrierende Clients oder lange Transaktionen prüfen.'
      WHEN IO_Time_Microseconds > 0 THEN
        'Hohe I/O Time: Datenträger, Indexe, große Ergebnismengen und Serverlast prüfen.'
      ELSE
        'Ziel konnte nicht eindeutig gematcht werden; Log-Ziel und ergänzende Serverlogs prüfen.'
    END AS Optimization_Hint
FROM base;

CREATE VIEW ServerTopCallDashboard AS
SELECT
    'top_call_rows' AS Metric_Key,
    'Top call rows' AS Metric_Label,
    COUNT(*) AS Metric_Value,
    10 AS Sort_Order
FROM ServerTopCallLogRaw
UNION ALL
SELECT
    'matched_rows',
    'Matched top call rows',
    COUNT(*),
    20
FROM ServerTopCallObjectMatches
WHERE Object_UUID IS NOT NULL
UNION ALL
SELECT
    'layout_targets',
    'Layout targets',
    COUNT(*),
    30
FROM ServerTopCallOptimizationSummary
WHERE Object_Type = 'Layout'
UNION ALL
SELECT
    'field_targets',
    'Field targets',
    COUNT(*),
    40
FROM ServerTopCallOptimizationSummary
WHERE Object_Type = 'Field'
UNION ALL
SELECT
    'script_targets',
    'Script targets',
    COUNT(*),
    50
FROM ServerTopCallOptimizationSummary
WHERE Object_Type = 'Script'
UNION ALL
SELECT
    'base_table_targets',
    'Base table targets',
    COUNT(*),
    60
FROM ServerTopCallOptimizationSummary
WHERE Object_Type = 'BaseTable';
