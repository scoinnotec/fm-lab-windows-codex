-- ============================================
-- create_quality_analysis.sql
-- ============================================
-- Cross-cutting FileMaker quality and risk analysis.
--
-- Purpose:
-- Materialize expensive checks after import so the REST API and web UI can
-- browse risks quickly: unreachable objects, risky script steps, broken field
-- and relationship references, naming issues, and import-to-import diffs.

SET threads=4;
SET preserve_insertion_order=false;

CREATE TABLE IF NOT EXISTS AnalysisIgnoreRules (
  Rule_ID VARCHAR PRIMARY KEY,
  Enabled BOOLEAN DEFAULT TRUE,
  Area VARCHAR,
  Issue_Category VARCHAR,
  Object_Type VARCHAR,
  Object_UUID VARCHAR,
  Object_Name_Pattern VARCHAR,
  File_Name VARCHAR,
  Reason VARCHAR,
  Created_At TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS AnalysisObjectSnapshot (
  Object_UUID VARCHAR,
  Object_Type VARCHAR,
  Object_Name VARCHAR,
  File_Name VARCHAR,
  Source_Table VARCHAR,
  Object_ID BIGINT,
  Object_Hash VARCHAR,
  Snapshot_At TIMESTAMP,
  PRIMARY KEY (Object_UUID, File_Name)
);

DROP TABLE IF EXISTS QualityFindingsRaw;
DROP TABLE IF EXISTS QualityFindings;
DROP TABLE IF EXISTS AnalysisDiffFindings;
DROP TABLE IF EXISTS AnalysisDashboard;

CREATE TEMP TABLE current_objects AS
SELECT *
FROM (
  SELECT
    Object_UUID,
    Object_Type,
    Object_Name,
    File_Name,
    Source_Table,
    Object_ID,
    md5(
      COALESCE(Object_Type, '') || '|' ||
      COALESCE(Object_Name, '') || '|' ||
      COALESCE(Source_Table, '') || '|' ||
      COALESCE(CAST(Object_ID AS VARCHAR), '')
    ) AS Object_Hash,
    ROW_NUMBER() OVER (
      PARTITION BY Object_UUID, File_Name
      ORDER BY Source_Table, Object_ID, Object_Type
    ) AS rn
  FROM ObjectCatalog
  WHERE Object_UUID IS NOT NULL
    AND File_Name IS NOT NULL
) deduped
WHERE rn = 1;

CREATE TABLE AnalysisDiffFindings AS
WITH previous_snapshot AS (
  SELECT *
  FROM AnalysisObjectSnapshot
),
diffs AS (
  SELECT
    md5('diff-new|' || c.Object_UUID || '|' || c.File_Name) AS Finding_ID,
    'Änderungen' AS Area,
    'DDR-Diff' AS Issue_Category,
    'Neues Objekt seit letztem Snapshot' AS Issue_Type,
    'info' AS Severity,
    c.Object_Type,
    c.Object_UUID,
    c.Object_Name,
    c.File_Name,
    c.Source_Table,
    c.Object_ID,
    NULL::VARCHAR AS Source_UUID,
    NULL::VARCHAR AS Source_Type,
    NULL::VARCHAR AS Source_Name,
    c.File_Name AS Source_File,
    NULL::INTEGER AS Step_Number,
    COALESCE(c.Object_Type, 'Objekt') || ': ' || COALESCE(c.Object_Name, c.Object_UUID) AS Source_Location,
    'Objekt existierte im vorherigen Snapshot nicht.' AS Detail_Text,
    NULL::BIGINT AS Usage_Count,
    NULL::VARCHAR AS Related_UUID,
    NULL::VARCHAR AS Related_Type,
    NULL::VARCHAR AS Related_Name,
    10 AS Sort_Order
  FROM current_objects c
  LEFT JOIN previous_snapshot p
    ON p.Object_UUID = c.Object_UUID
   AND p.File_Name = c.File_Name
  WHERE p.Object_UUID IS NULL
    AND EXISTS (SELECT 1 FROM previous_snapshot)

  UNION ALL

  SELECT
    md5('diff-deleted|' || p.Object_UUID || '|' || p.File_Name) AS Finding_ID,
    'Änderungen' AS Area,
    'DDR-Diff' AS Issue_Category,
    'Objekt seit letztem Snapshot entfernt' AS Issue_Type,
    'medium' AS Severity,
    p.Object_Type,
    p.Object_UUID,
    p.Object_Name,
    p.File_Name,
    p.Source_Table,
    p.Object_ID,
    NULL::VARCHAR AS Source_UUID,
    NULL::VARCHAR AS Source_Type,
    NULL::VARCHAR AS Source_Name,
    p.File_Name AS Source_File,
    NULL::INTEGER AS Step_Number,
    COALESCE(p.Object_Type, 'Objekt') || ': ' || COALESCE(p.Object_Name, p.Object_UUID) AS Source_Location,
    'Objekt existiert im aktuellen Import nicht mehr.' AS Detail_Text,
    NULL::BIGINT AS Usage_Count,
    NULL::VARCHAR AS Related_UUID,
    NULL::VARCHAR AS Related_Type,
    NULL::VARCHAR AS Related_Name,
    20 AS Sort_Order
  FROM previous_snapshot p
  LEFT JOIN current_objects c
    ON c.Object_UUID = p.Object_UUID
   AND c.File_Name = p.File_Name
  WHERE c.Object_UUID IS NULL

  UNION ALL

  SELECT
    md5('diff-changed|' || c.Object_UUID || '|' || c.File_Name) AS Finding_ID,
    'Änderungen' AS Area,
    'DDR-Diff' AS Issue_Category,
    'Objekt-Metadaten geändert' AS Issue_Type,
    'info' AS Severity,
    c.Object_Type,
    c.Object_UUID,
    c.Object_Name,
    c.File_Name,
    c.Source_Table,
    c.Object_ID,
    NULL::VARCHAR AS Source_UUID,
    NULL::VARCHAR AS Source_Type,
    NULL::VARCHAR AS Source_Name,
    c.File_Name AS Source_File,
    NULL::INTEGER AS Step_Number,
    COALESCE(c.Object_Type, 'Objekt') || ': ' || COALESCE(c.Object_Name, c.Object_UUID) AS Source_Location,
    'Name/Typ/Quelle hat sich seit dem vorherigen Snapshot geändert.' AS Detail_Text,
    NULL::BIGINT AS Usage_Count,
    p.Object_UUID AS Related_UUID,
    p.Object_Type AS Related_Type,
    p.Object_Name AS Related_Name,
    30 AS Sort_Order
  FROM current_objects c
  JOIN previous_snapshot p
    ON p.Object_UUID = c.Object_UUID
   AND p.File_Name = c.File_Name
  WHERE p.Object_Hash <> c.Object_Hash
)
SELECT *
FROM diffs;

DELETE FROM AnalysisObjectSnapshot;

INSERT INTO AnalysisObjectSnapshot
SELECT
  Object_UUID,
  Object_Type,
  Object_Name,
  File_Name,
  Source_Table,
  Object_ID,
  Object_Hash,
  CURRENT_TIMESTAMP AS Snapshot_At
FROM current_objects;

CREATE TABLE QualityFindingsRaw AS
WITH
usage_summary AS (
  SELECT *
  FROM ObjectUsageSummary
  WHERE Object_Type IN ('Script', 'Layout', 'CustomFunction', 'ValueList', 'Field', 'BaseTable')
),
duplicate_names AS (
  SELECT
    Object_UUID,
    File_Name,
    COUNT(*) OVER (
      PARTITION BY File_Name, Object_Type, lower(trim(Object_Name))
    ) AS Duplicate_Count
  FROM ObjectCatalog
  WHERE COALESCE(trim(Object_Name), '') <> ''
),
script_risk_steps AS (
  SELECT
    s.*,
    CASE
      WHEN s.Step_Name IN ('Delete All Records', 'Truncate Table') THEN 'high'
      WHEN s.Step_Name IN ('Delete Record/Request', 'Replace Field Contents', 'Import Records') THEN 'high'
      WHEN s.Step_Name IN ('Export Records', 'Export Field Contents', 'Save Records as PDF', 'Send Mail', 'Insert from URL', 'Send Event', 'Open URL', 'Open Data File', 'Write to Data File', 'Create Data File') THEN 'medium'
      WHEN s.Step_Name IN ('Halt Script', 'Perform Script on Server', 'Show All Records') THEN 'medium'
      ELSE 'info'
    END AS Severity,
    CASE
      WHEN s.Step_Name IN ('Delete All Records', 'Truncate Table', 'Delete Record/Request') THEN 'Datenlöschung'
      WHEN s.Step_Name IN ('Replace Field Contents', 'Import Records') THEN 'Massendatenänderung'
      WHEN s.Step_Name IN ('Export Records', 'Export Field Contents', 'Save Records as PDF') THEN 'Datenexport'
      WHEN s.Step_Name IN ('Send Mail') THEN 'Mailversand'
      WHEN s.Step_Name IN ('Insert from URL', 'Open URL') THEN 'HTTP/API'
      WHEN s.Step_Name IN ('Send Event', 'Open Data File', 'Write to Data File', 'Create Data File') THEN 'Datei/System'
      WHEN s.Step_Name IN ('Perform Script on Server') THEN 'Serverausführung'
      ELSE 'Script-Risiko'
    END AS Risk_Category
  FROM StepsForScripts s
  WHERE s.Step_Name IN (
    'Delete All Records',
    'Truncate Table',
    'Delete Record/Request',
    'Replace Field Contents',
    'Import Records',
    'Export Records',
    'Export Field Contents',
    'Save Records as PDF',
    'Send Mail',
    'Insert from URL',
    'Open URL',
    'Send Event',
    'Open Data File',
    'Write to Data File',
    'Create Data File',
    'Halt Script',
    'Perform Script on Server',
    'Show All Records'
  )
),
broken_step_refs AS (
  SELECT
    xsr.*,
    COALESCE(s.Script_Name, 'Script') AS Script_Name,
    COALESCE(s.Step_Index + 1, TRY_CAST(xsr.Step_Index AS INTEGER) + 1) AS Step_Number
  FROM XMLStepReferences xsr
  LEFT JOIN ObjectCatalog target
    ON target.Object_UUID = xsr.Ref_UUID
   AND target.File_Name = xsr.File_Name
  LEFT JOIN StepsForScripts s
    ON s.Step_UUID = xsr.Step_UUID
   AND s.File_Name = xsr.File_Name
  WHERE xsr.Ref_Type IN ('field', 'script', 'layout', 'tableOccurrence')
    AND xsr.Ref_UUID IS NOT NULL
    AND target.Object_UUID IS NULL
),
broken_layout_refs AS (
  SELECT
    xlr.*,
    lo.Layout_ID,
    lo.Object_Name AS Layout_Object_Name,
    lo.Object_Type AS Layout_Object_Type,
    l.L_UUID AS Layout_UUID,
    l.L_Name AS Layout_Name
  FROM XMLLayoutReferences xlr
  LEFT JOIN ObjectCatalog target
    ON target.Object_UUID = xlr.Ref_UUID
   AND target.File_Name = xlr.File_Name
  LEFT JOIN LayoutObjects lo
    ON lo.Object_UUID = xlr.Object_UUID
   AND lo.File_Name = xlr.File_Name
  LEFT JOIN Layouts l
    ON l.L_ID = lo.Layout_ID
   AND l.File_Name = lo.File_Name
  WHERE xlr.Ref_Type IN ('field', 'script', 'layout', 'table_occurrence', 'valuelist')
    AND xlr.Ref_UUID IS NOT NULL
    AND target.Object_UUID IS NULL
),
broken_relationship_refs AS (
  SELECT
    rc.*,
    oc.Object_UUID AS Relationship_UUID,
    oc.Object_Name AS Relationship_Name,
    CASE
      WHEN left_to.TO_UUID IS NULL THEN 'Linker TO fehlt'
      WHEN right_to.TO_UUID IS NULL THEN 'Rechter TO fehlt'
      WHEN left_field.Field_UUID IS NULL THEN 'Linkes Beziehungsfeld fehlt'
      WHEN right_field.Field_UUID IS NULL THEN 'Rechtes Beziehungsfeld fehlt'
      ELSE 'Beziehung unvollständig'
    END AS Issue_Type,
    CASE
      WHEN left_to.TO_UUID IS NULL OR right_to.TO_UUID IS NULL THEN 'high'
      ELSE 'high'
    END AS Severity
  FROM RelationshipCatalog rc
  LEFT JOIN TableOccurrenceCatalog left_to
    ON left_to.TO_UUID = rc.Left_TO_UUID
   AND left_to.File_Name = rc.File_Name
  LEFT JOIN TableOccurrenceCatalog right_to
    ON right_to.TO_UUID = rc.Right_TO_UUID
   AND right_to.File_Name = rc.File_Name
  LEFT JOIN FieldsForTables left_field
    ON left_field.Field_UUID = rc.Left_Field_UUID
   AND left_field.File_Name = rc.File_Name
  LEFT JOIN FieldsForTables right_field
    ON right_field.Field_UUID = rc.Right_Field_UUID
   AND right_field.File_Name = rc.File_Name
  LEFT JOIN ObjectCatalog oc
    ON oc.Source_Table = 'RelationshipCatalog'
   AND oc.Object_ID = rc.Rel_ID
   AND oc.File_Name = rc.File_Name
  WHERE left_to.TO_UUID IS NULL
     OR right_to.TO_UUID IS NULL
     OR left_field.Field_UUID IS NULL
     OR right_field.Field_UUID IS NULL
),
broken_lookup_refs AS (
  SELECT
    f.*,
    CASE
      WHEN f.Lookup_TO_UUID IS NOT NULL AND toc.TO_UUID IS NULL THEN 'Lookup-TO fehlt'
      WHEN f.Lookup_Field_UUID IS NOT NULL AND lf.Field_UUID IS NULL THEN 'Lookup-Feld fehlt'
      ELSE 'Lookup unvollständig'
    END AS Issue_Type
  FROM FieldsForTables f
  LEFT JOIN TableOccurrenceCatalog toc
    ON toc.TO_UUID = f.Lookup_TO_UUID
   AND toc.File_Name = f.File_Name
  LEFT JOIN FieldsForTables lf
    ON lf.Field_UUID = f.Lookup_Field_UUID
   AND lf.File_Name = f.File_Name
  WHERE (f.Lookup_TO_UUID IS NOT NULL AND toc.TO_UUID IS NULL)
     OR (f.Lookup_Field_UUID IS NOT NULL AND lf.Field_UUID IS NULL)
),
findings AS (
  SELECT
    md5('unreachable|' || Object_UUID || '|' || File_Name) AS Finding_ID,
    'Erreichbarkeit' AS Area,
    'Nicht erreichbar' AS Issue_Category,
    CASE
      WHEN Object_Type = 'Script' THEN 'Script ohne erkannte Nutzung'
      WHEN Object_Type = 'Layout' THEN 'Layout ohne erkannte Nutzung'
      ELSE Object_Type || ' ohne erkannte Nutzung'
    END AS Issue_Type,
    CASE WHEN Object_Type IN ('Script', 'Layout') THEN 'medium' ELSE 'info' END AS Severity,
    Object_Type,
    Object_UUID,
    Object_Name,
    File_Name,
    Source_Table,
    Object_ID,
    NULL::VARCHAR AS Source_UUID,
    NULL::VARCHAR AS Source_Type,
    NULL::VARCHAR AS Source_Name,
    File_Name AS Source_File,
    NULL::INTEGER AS Step_Number,
    COALESCE(Object_Name, Object_UUID) AS Source_Location,
    'Keine eingehende operative Referenz in ObjectUsageSummary.' AS Detail_Text,
    Usage_Count,
    NULL::VARCHAR AS Related_UUID,
    NULL::VARCHAR AS Related_Type,
    NULL::VARCHAR AS Related_Name,
    100 AS Sort_Order
  FROM usage_summary
  WHERE Usage_Count = 0
    AND Object_Type IN ('Script', 'Layout', 'CustomFunction', 'ValueList')

  UNION ALL

  SELECT
    md5('rare|' || Object_UUID || '|' || File_Name) AS Finding_ID,
    'Erreichbarkeit' AS Area,
    'Selten genutzt' AS Issue_Category,
    Object_Type || ' sehr selten referenziert' AS Issue_Type,
    'info' AS Severity,
    Object_Type,
    Object_UUID,
    Object_Name,
    File_Name,
    Source_Table,
    Object_ID,
    NULL::VARCHAR AS Source_UUID,
    NULL::VARCHAR AS Source_Type,
    NULL::VARCHAR AS Source_Name,
    File_Name AS Source_File,
    NULL::INTEGER AS Step_Number,
    COALESCE(Object_Name, Object_UUID) AS Source_Location,
    'Nur ' || CAST(Usage_Count AS VARCHAR) || ' erkannte Referenz(en).' AS Detail_Text,
    Usage_Count,
    NULL::VARCHAR AS Related_UUID,
    NULL::VARCHAR AS Related_Type,
    NULL::VARCHAR AS Related_Name,
    110 AS Sort_Order
  FROM usage_summary
  WHERE Usage_Count BETWEEN 1 AND 2
    AND Object_Type IN ('Script', 'Layout', 'CustomFunction', 'ValueList')

  UNION ALL

  SELECT
    md5('script-risk|' || Step_UUID || '|' || File_Name) AS Finding_ID,
    'Script-Risiken' AS Area,
    Risk_Category AS Issue_Category,
    Step_Name AS Issue_Type,
    Severity,
    'Script' AS Object_Type,
    Script_UUID AS Object_UUID,
    Script_Name AS Object_Name,
    File_Name,
    'ScriptCatalog' AS Source_Table,
    Script_ID AS Object_ID,
    Script_UUID AS Source_UUID,
    'Script' AS Source_Type,
    Script_Name AS Source_Name,
    File_Name AS Source_File,
    Step_Index + 1 AS Step_Number,
    Script_Name || ' [Schritt ' || CAST(Step_Index + 1 AS VARCHAR) || '] ' || Step_Name AS Source_Location,
    COALESCE(Calculation_Text, Variable_Name, Parameter_Type, '') AS Detail_Text,
    NULL::BIGINT AS Usage_Count,
    Step_UUID AS Related_UUID,
    'ScriptStep' AS Related_Type,
    Step_Name AS Related_Name,
    200 AS Sort_Order
  FROM script_risk_steps

  UNION ALL

  SELECT
    md5('broken-step-ref|' || Step_UUID || '|' || Ref_Type || '|' || COALESCE(Ref_UUID, Ref_Name, '') || '|' || File_Name) AS Finding_ID,
    'Referenzfehler' AS Area,
    'Script-Referenz' AS Issue_Category,
    'Script-Schritt verweist auf fehlendes Ziel' AS Issue_Type,
    CASE WHEN Ref_Type IN ('field', 'script') THEN 'high' ELSE 'medium' END AS Severity,
    'Script' AS Object_Type,
    Script_UUID AS Object_UUID,
    Script_Name AS Object_Name,
    File_Name,
    'ScriptCatalog' AS Source_Table,
    NULL::BIGINT AS Object_ID,
    Script_UUID AS Source_UUID,
    'Script' AS Source_Type,
    Script_Name AS Source_Name,
    File_Name AS Source_File,
    Step_Number,
    Script_Name || ' [Schritt ' || CAST(COALESCE(Step_Number, 0) AS VARCHAR) || '] ' || COALESCE(Step_Name, '') AS Source_Location,
    'Fehlende ' || Ref_Type || '-Referenz: ' || COALESCE(Ref_Name, Ref_UUID, '?') AS Detail_Text,
    NULL::BIGINT AS Usage_Count,
    Ref_UUID AS Related_UUID,
    Ref_Type AS Related_Type,
    Ref_Name AS Related_Name,
    300 AS Sort_Order
  FROM broken_step_refs

  UNION ALL

  SELECT
    md5('broken-layout-ref|' || Object_UUID || '|' || Ref_Type || '|' || COALESCE(Ref_UUID, Ref_Name, '') || '|' || File_Name) AS Finding_ID,
    'Referenzfehler' AS Area,
    'Layout-Referenz' AS Issue_Category,
    'Layoutobjekt verweist auf fehlendes Ziel' AS Issue_Type,
    CASE WHEN Ref_Type = 'field' THEN 'high' ELSE 'medium' END AS Severity,
    'LayoutObject' AS Object_Type,
    Object_UUID,
    COALESCE(Layout_Object_Name, Layout_Object_Type, 'LayoutObject') AS Object_Name,
    File_Name,
    'LayoutObjects' AS Source_Table,
    NULL::BIGINT AS Object_ID,
    Layout_UUID AS Source_UUID,
    'Layout' AS Source_Type,
    Layout_Name AS Source_Name,
    File_Name AS Source_File,
    NULL::INTEGER AS Step_Number,
    COALESCE(Layout_Name, 'Layout') || ' / ' || COALESCE(Layout_Object_Name, Layout_Object_Type, 'LayoutObject') AS Source_Location,
    'Fehlende ' || Ref_Type || '-Referenz: ' || COALESCE(Ref_Name, Ref_UUID, '?') AS Detail_Text,
    NULL::BIGINT AS Usage_Count,
    Ref_UUID AS Related_UUID,
    Ref_Type AS Related_Type,
    Ref_Name AS Related_Name,
    310 AS Sort_Order
  FROM broken_layout_refs

  UNION ALL

  SELECT
    md5('broken-relationship|' || CAST(Rel_ID AS VARCHAR) || '|' || Issue_Type || '|' || File_Name) AS Finding_ID,
    'Referenzfehler' AS Area,
    'Beziehung' AS Issue_Category,
    Issue_Type,
    Severity,
    'Relationship' AS Object_Type,
    Relationship_UUID AS Object_UUID,
    Relationship_Name AS Object_Name,
    File_Name,
    'RelationshipCatalog' AS Source_Table,
    Rel_ID AS Object_ID,
    Relationship_UUID AS Source_UUID,
    'Relationship' AS Source_Type,
    Relationship_Name AS Source_Name,
    File_Name AS Source_File,
    NULL::INTEGER AS Step_Number,
    COALESCE(Relationship_Name, Left_TO_Name || ' ' || Operator || ' ' || Right_TO_Name) AS Source_Location,
    COALESCE(Left_TO_Name, '?') || '::' || COALESCE(Left_Field_Name, '?') || ' ' ||
      COALESCE(Operator, '?') || ' ' ||
      COALESCE(Right_TO_Name, '?') || '::' || COALESCE(Right_Field_Name, '?') AS Detail_Text,
    NULL::BIGINT AS Usage_Count,
    NULL::VARCHAR AS Related_UUID,
    NULL::VARCHAR AS Related_Type,
    NULL::VARCHAR AS Related_Name,
    320 AS Sort_Order
  FROM broken_relationship_refs

  UNION ALL

  SELECT
    md5('broken-lookup|' || Field_UUID || '|' || Issue_Type || '|' || File_Name) AS Finding_ID,
    'Referenzfehler' AS Area,
    'Feld-Lookup' AS Issue_Category,
    Issue_Type,
    'high' AS Severity,
    'Field' AS Object_Type,
    Field_UUID AS Object_UUID,
    Table_Name || '::' || Field_Name AS Object_Name,
    File_Name,
    'FieldsForTables' AS Source_Table,
    Field_ID AS Object_ID,
    Field_UUID AS Source_UUID,
    'Field' AS Source_Type,
    Table_Name || '::' || Field_Name AS Source_Name,
    File_Name AS Source_File,
    NULL::INTEGER AS Step_Number,
    Table_Name || '::' || Field_Name AS Source_Location,
    'Lookup: ' || COALESCE(Lookup_TO_Name, '?') || '::' || COALESCE(Lookup_Field_Name, '?') AS Detail_Text,
    NULL::BIGINT AS Usage_Count,
    COALESCE(Lookup_Field_UUID, Lookup_TO_UUID) AS Related_UUID,
    'Lookup' AS Related_Type,
    COALESCE(Lookup_Field_Name, Lookup_TO_Name) AS Related_Name,
    330 AS Sort_Order
  FROM broken_lookup_refs

  UNION ALL

  SELECT
    md5('field-empty-calc|' || Field_UUID || '|' || File_Name) AS Finding_ID,
    'Feld-Qualität' AS Area,
    'Berechnung' AS Issue_Category,
    'Berechnungsfeld ohne Formeltext' AS Issue_Type,
    'high' AS Severity,
    'Field' AS Object_Type,
    Field_UUID AS Object_UUID,
    Table_Name || '::' || Field_Name AS Object_Name,
    File_Name,
    'FieldsForTables' AS Source_Table,
    Field_ID AS Object_ID,
    Field_UUID AS Source_UUID,
    'Field' AS Source_Type,
    Table_Name || '::' || Field_Name AS Source_Name,
    File_Name AS Source_File,
    NULL::INTEGER AS Step_Number,
    Table_Name || '::' || Field_Name AS Source_Location,
    'Field_Type=Calculated, Calculation_Text ist leer.' AS Detail_Text,
    NULL::BIGINT AS Usage_Count,
    NULL::VARCHAR AS Related_UUID,
    NULL::VARCHAR AS Related_Type,
    NULL::VARCHAR AS Related_Name,
    400 AS Sort_Order
  FROM FieldsForTables
  WHERE Field_Type = 'Calculated'
    AND COALESCE(trim(Calculation_Text), '') = ''

  UNION ALL

  SELECT
    md5('field-unused|' || Object_UUID || '|' || File_Name) AS Finding_ID,
    'Feld-Qualität' AS Area,
    'Unbenutztes Feld' AS Issue_Category,
    'Feld ohne erkannte Nutzung' AS Issue_Type,
    'info' AS Severity,
    Object_Type,
    Object_UUID,
    Object_Name,
    File_Name,
    Source_Table,
    Object_ID,
    NULL::VARCHAR AS Source_UUID,
    NULL::VARCHAR AS Source_Type,
    NULL::VARCHAR AS Source_Name,
    File_Name AS Source_File,
    NULL::INTEGER AS Step_Number,
    COALESCE(Object_Name, Object_UUID) AS Source_Location,
    'Keine eingehende operative Referenz erkannt.' AS Detail_Text,
    Usage_Count,
    NULL::VARCHAR AS Related_UUID,
    NULL::VARCHAR AS Related_Type,
    NULL::VARCHAR AS Related_Name,
    410 AS Sort_Order
  FROM usage_summary
  WHERE Object_Type = 'Field'
    AND Usage_Count = 0

  UNION ALL

  SELECT
    md5('name-duplicate|' || oc.Object_UUID || '|' || oc.File_Name) AS Finding_ID,
    'Namenskonventionen' AS Area,
    'Doppelte Namen' AS Issue_Category,
    'Doppelter Objektname innerhalb des Typs' AS Issue_Type,
    'medium' AS Severity,
    oc.Object_Type,
    oc.Object_UUID,
    oc.Object_Name,
    oc.File_Name,
    oc.Source_Table,
    oc.Object_ID,
    NULL::VARCHAR AS Source_UUID,
    NULL::VARCHAR AS Source_Type,
    NULL::VARCHAR AS Source_Name,
    oc.File_Name AS Source_File,
    NULL::INTEGER AS Step_Number,
    COALESCE(oc.Object_Type, 'Objekt') || ': ' || COALESCE(oc.Object_Name, oc.Object_UUID) AS Source_Location,
    'Name kommt ' || CAST(dn.Duplicate_Count AS VARCHAR) || 'x im gleichen Objekttyp vor.' AS Detail_Text,
    NULL::BIGINT AS Usage_Count,
    NULL::VARCHAR AS Related_UUID,
    NULL::VARCHAR AS Related_Type,
    NULL::VARCHAR AS Related_Name,
    500 AS Sort_Order
  FROM ObjectCatalog oc
  JOIN duplicate_names dn
    ON dn.Object_UUID = oc.Object_UUID
   AND dn.File_Name = oc.File_Name
  WHERE dn.Duplicate_Count > 1
    AND oc.Object_Type IN ('Script', 'Layout', 'CustomFunction', 'ValueList', 'Field', 'LayoutObject')

  UNION ALL

  SELECT
    md5('name-copy|' || Object_UUID || '|' || File_Name) AS Finding_ID,
    'Namenskonventionen' AS Area,
    'Kopie-Namen' AS Issue_Category,
    'Name sieht nach kopiertem Objekt aus' AS Issue_Type,
    'medium' AS Severity,
    Object_Type,
    Object_UUID,
    Object_Name,
    File_Name,
    Source_Table,
    Object_ID,
    NULL::VARCHAR AS Source_UUID,
    NULL::VARCHAR AS Source_Type,
    NULL::VARCHAR AS Source_Name,
    File_Name AS Source_File,
    NULL::INTEGER AS Step_Number,
    COALESCE(Object_Type, 'Objekt') || ': ' || COALESCE(Object_Name, Object_UUID) AS Source_Location,
    'Name enthaelt Kopie/Copy/Duplikat-Muster.' AS Detail_Text,
    NULL::BIGINT AS Usage_Count,
    NULL::VARCHAR AS Related_UUID,
    NULL::VARCHAR AS Related_Type,
    NULL::VARCHAR AS Related_Name,
    510 AS Sort_Order
  FROM ObjectCatalog
  WHERE regexp_matches(lower(COALESCE(Object_Name, '')), '(copy|kopie|duplikat|duplicate)')

  UNION ALL

  SELECT * FROM AnalysisDiffFindings
)
SELECT *
FROM findings
WHERE Finding_ID IS NOT NULL;

CREATE TABLE QualityFindings AS
SELECT f.*
FROM QualityFindingsRaw f
LEFT JOIN AnalysisIgnoreRules r
  ON r.Enabled = TRUE
 AND (r.Area IS NULL OR r.Area = f.Area)
 AND (r.Issue_Category IS NULL OR r.Issue_Category = f.Issue_Category)
 AND (r.Object_Type IS NULL OR r.Object_Type = f.Object_Type)
 AND (r.Object_UUID IS NULL OR r.Object_UUID = f.Object_UUID)
 AND (r.File_Name IS NULL OR r.File_Name = f.File_Name)
 AND (
   r.Object_Name_Pattern IS NULL
   OR lower(COALESCE(f.Object_Name, '')) LIKE lower(r.Object_Name_Pattern)
 )
WHERE r.Rule_ID IS NULL;

CREATE TABLE AnalysisDashboard AS
WITH object_counts AS (
  SELECT Object_Type AS Metric_Key, COUNT(*) AS Metric_Value
  FROM ObjectCatalog
  GROUP BY Object_Type
),
quality_counts AS (
  SELECT Area AS Metric_Key, COUNT(*) AS Metric_Value
  FROM QualityFindings
  GROUP BY Area
),
layout_quality_counts AS (
  SELECT Issue_Category AS Metric_Key, COUNT(*) AS Metric_Value
  FROM LayoutObjectQualityFindings
  GROUP BY Issue_Category
),
credential_counts AS (
  SELECT Source_Category AS Metric_Key, COUNT(*) AS Metric_Value
  FROM CredentialFindings
  GROUP BY Source_Category
)
SELECT 'Objekte' AS Section, Metric_Key, Metric_Value, 10 AS Sort_Order FROM object_counts
UNION ALL
SELECT 'Qualität', Metric_Key, Metric_Value, 20 FROM quality_counts
UNION ALL
SELECT 'Layout-Prüfung', Metric_Key, Metric_Value, 30 FROM layout_quality_counts
UNION ALL
SELECT 'Zugangsdaten', Metric_Key, Metric_Value, 40 FROM credential_counts
UNION ALL
SELECT 'Import', 'Dateien', COUNT(*), 50 FROM FilesCatalog
UNION ALL
SELECT 'Import', 'Letzter Import', epoch_ms(MAX(Import_Timestamp)), 51 FROM FilesCatalog;
