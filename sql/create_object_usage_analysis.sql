-- ============================================
-- create_object_usage_analysis.sql
-- ============================================
-- Precomputed usage analysis for normal FileMaker objects.
--
-- Purpose:
-- Find unused and rarely referenced scripts, layouts, custom functions,
-- value lists, fields, and base tables without doing expensive live scans
-- in the REST API.
--
-- Important:
-- Structural child links are intentionally excluded. A script is not "used"
-- just because it contains script steps, and a layout is not "used" just
-- because it contains layout objects.

SET threads=4;
SET preserve_insertion_order=false;

DROP TABLE IF EXISTS ObjectUsageSummary;
DROP TABLE IF EXISTS ObjectUsageDetails;

CREATE TABLE ObjectUsageDetails AS
WITH supported_types(Object_Type) AS (
  VALUES
    ('Script'),
    ('Layout'),
    ('CustomFunction'),
    ('ValueList'),
    ('Field'),
    ('BaseTable')
),
step_ref_usage AS (
  SELECT
    target.Object_UUID AS Target_UUID,
    target.File_Name AS Target_File,
    target.Object_Type AS Target_Type,
    CASE
      WHEN xsr.Ref_Type = 'script' THEN 'Script-Aufruf'
      WHEN xsr.Ref_Type = 'layout' THEN 'Layoutwechsel'
      WHEN xsr.Ref_Type = 'field' AND COALESCE(s.Step_Name, xsr.Step_Name) = 'Set Field' THEN 'Feld setzen'
      WHEN xsr.Ref_Type = 'field' AND COALESCE(s.Step_Name, xsr.Step_Name) IN ('Export Records', 'Export Field Contents') THEN 'Feld exportieren'
      WHEN xsr.Ref_Type = 'field' AND COALESCE(s.Step_Name, xsr.Step_Name) = 'Import Records' THEN 'Feld importieren'
      WHEN xsr.Ref_Type = 'field' AND COALESCE(s.Step_Name, xsr.Step_Name) LIKE 'Sort%' THEN 'Feld sortieren'
      WHEN xsr.Ref_Type = 'field' AND COALESCE(s.Step_Name, xsr.Step_Name) = 'Go to Field' THEN 'Feldnavigation'
      WHEN xsr.Ref_Type = 'field' THEN 'Script-Feldreferenz'
      ELSE 'Script-Referenz'
    END AS Usage_Category,
    'Script' AS Source_Type,
    COALESCE(s.Script_UUID, xsr.Script_UUID) AS Source_UUID,
    COALESCE(s.Script_Name, source.Object_Name, 'Script') AS Source_Name,
    COALESCE(s.File_Name, xsr.File_Name) AS Source_File,
    COALESCE(s.Step_Index + 1, TRY_CAST(xsr.Step_Index AS INTEGER) + 1) AS Step_Number,
    COALESCE(s.Script_Name, source.Object_Name, 'Script') || ' [Schritt ' ||
      CAST(COALESCE(s.Step_Index + 1, TRY_CAST(xsr.Step_Index AS INTEGER) + 1) AS VARCHAR) ||
      '] ' || COALESCE(s.Step_Name, xsr.Step_Name, '') AS Source_Location,
    COALESCE(xsr.Ref_Name, target.Object_Name) AS Detail_Text
  FROM XMLStepReferences xsr
  JOIN ObjectCatalog target
    ON target.Object_UUID = xsr.Ref_UUID
   AND target.File_Name = xsr.File_Name
  JOIN supported_types st
    ON st.Object_Type = target.Object_Type
  LEFT JOIN StepsForScripts s
    ON s.Step_UUID = xsr.Step_UUID
   AND s.File_Name = xsr.File_Name
  LEFT JOIN ObjectCatalog source
    ON source.Object_UUID = xsr.Script_UUID
   AND source.File_Name = xsr.File_Name
  WHERE xsr.Ref_Type IN ('script', 'layout', 'field')
    AND xsr.Ref_UUID IS NOT NULL
),
operational_link_usage AS (
  SELECT
    target.Object_UUID AS Target_UUID,
    target.File_Name AS Target_File,
    target.Object_Type AS Target_Type,
    CASE
      WHEN ol.Link_Role IN ('triggers_script', 'trigger_script') THEN 'Script-Trigger'
      WHEN ol.Link_Role = 'uses_valuelist' THEN 'Werteliste'
      WHEN ol.Link_Role = 'displays_field' THEN 'Feld auf Layout'
      WHEN ol.Link_Role IN ('left_field', 'right_field') THEN 'Beziehung'
      WHEN ol.Link_Role = 'base_table' THEN 'TO basiert auf Basistabelle'
      ELSE COALESCE(ol.Link_Role, 'Referenz')
    END AS Usage_Category,
    ol.Source_Type,
    ol.Source_UUID,
    COALESCE(source.Object_Name, ol.Source_UUID, ol.Source_Type) AS Source_Name,
    ol.Source_File,
    NULL::INTEGER AS Step_Number,
    COALESCE(source.Object_Name, ol.Source_UUID, ol.Source_Type) AS Source_Location,
    COALESCE(ol.Link_Subrole, ol.Link_Role, '') AS Detail_Text
  FROM ObjectLinks ol
  JOIN ObjectCatalog target
    ON target.Object_UUID = ol.Target_UUID
   AND target.File_Name = ol.Target_File
  JOIN supported_types st
    ON st.Object_Type = target.Object_Type
  LEFT JOIN ObjectCatalog source
    ON source.Object_UUID = ol.Source_UUID
   AND source.File_Name = ol.Source_File
  WHERE ol.Link_Type = 'operational'
    AND ol.Link_Role NOT IN (
      'calls_script',
      'navigates_to_layout',
      'sets_field',
      'reads_field',
      'imports_to_field',
      'exports_from_field',
      'sorts_by_field',
      'navigates_to_field',
      'references_field',
      'inputs_to_field',
      'finds_in_field'
    )
),
custom_function_usage AS (
  SELECT
    target.Object_UUID AS Target_UUID,
    target.File_Name AS Target_File,
    target.Object_Type AS Target_Type,
    'Script-Formel' AS Usage_Category,
    'Script' AS Source_Type,
    s.Script_UUID AS Source_UUID,
    s.Script_Name AS Source_Name,
    s.File_Name AS Source_File,
    s.Step_Index + 1 AS Step_Number,
    s.Script_Name || ' [Schritt ' || CAST(s.Step_Index + 1 AS VARCHAR) || '] ' || COALESCE(s.Step_Name, '') AS Source_Location,
    'Formel enthaelt ' || target.Object_Name || '(' AS Detail_Text
  FROM ObjectCatalog target
  JOIN StepsForScripts s
    ON s.File_Name = target.File_Name
   AND contains(lower(replace(COALESCE(s.Calculation_Text, ''), ' ', '')), lower(target.Object_Name || '('))
  WHERE target.Object_Type = 'CustomFunction'
    AND COALESCE(s.Calculation_Text, '') <> ''

  UNION ALL

  SELECT
    target.Object_UUID AS Target_UUID,
    target.File_Name AS Target_File,
    target.Object_Type AS Target_Type,
    'Feld-Berechnung' AS Usage_Category,
    'Field' AS Source_Type,
    f.Field_UUID AS Source_UUID,
    f.Table_Name || '::' || f.Field_Name AS Source_Name,
    f.File_Name AS Source_File,
    NULL::INTEGER AS Step_Number,
    f.Table_Name || '::' || f.Field_Name AS Source_Location,
    'Formel enthaelt ' || target.Object_Name || '(' AS Detail_Text
  FROM ObjectCatalog target
  JOIN FieldsForTables f
    ON f.File_Name = target.File_Name
   AND contains(lower(replace(COALESCE(f.Calculation_Text, ''), ' ', '')), lower(target.Object_Name || '('))
  WHERE target.Object_Type = 'CustomFunction'
    AND COALESCE(f.Calculation_Text, '') <> ''

  UNION ALL

  SELECT
    target.Object_UUID AS Target_UUID,
    target.File_Name AS Target_File,
    target.Object_Type AS Target_Type,
    'Auto-Enter' AS Usage_Category,
    'Field' AS Source_Type,
    f.Field_UUID AS Source_UUID,
    f.Table_Name || '::' || f.Field_Name AS Source_Name,
    f.File_Name AS Source_File,
    NULL::INTEGER AS Step_Number,
    f.Table_Name || '::' || f.Field_Name AS Source_Location,
    'Auto-Enter-Formel enthaelt ' || target.Object_Name || '(' AS Detail_Text
  FROM ObjectCatalog target
  JOIN FieldsForTables f
    ON f.File_Name = target.File_Name
   AND contains(lower(replace(COALESCE(f.AE_Calc_Text, ''), ' ', '')), lower(target.Object_Name || '('))
  WHERE target.Object_Type = 'CustomFunction'
    AND COALESCE(f.AE_Calc_Text, '') <> ''

  UNION ALL

  SELECT
    target.Object_UUID AS Target_UUID,
    target.File_Name AS Target_File,
    target.Object_Type AS Target_Type,
    'Custom Function' AS Usage_Category,
    'CustomFunction' AS Source_Type,
    source_cf.CF_UUID AS Source_UUID,
    source_cf.CF_Name AS Source_Name,
    source_cf.File_Name AS Source_File,
    NULL::INTEGER AS Step_Number,
    source_cf.CF_Name AS Source_Location,
    'Custom Function enthaelt ' || target.Object_Name || '(' AS Detail_Text
  FROM ObjectCatalog target
  JOIN CalcsForCustomFunctions source_cf
    ON source_cf.File_Name = target.File_Name
   AND source_cf.CF_UUID <> target.Object_UUID
   AND contains(lower(replace(COALESCE(source_cf.Calculation_Code, ''), ' ', '')), lower(target.Object_Name || '('))
  WHERE target.Object_Type = 'CustomFunction'
    AND COALESCE(source_cf.Calculation_Code, '') <> ''

  UNION ALL

  SELECT
    target.Object_UUID AS Target_UUID,
    target.File_Name AS Target_File,
    target.Object_Type AS Target_Type,
    'Layout-Formel' AS Usage_Category,
    'LayoutObject' AS Source_Type,
    lo.Object_UUID AS Source_UUID,
    COALESCE(lo.Object_Name, lo.Object_Type, 'LayoutObject') AS Source_Name,
    lo.File_Name AS Source_File,
    NULL::INTEGER AS Step_Number,
    COALESCE(l.L_Name || ' / ' || COALESCE(lo.Object_Name, lo.Object_Type), COALESCE(lo.Object_Name, lo.Object_Type)) AS Source_Location,
    'Layout-Objekt-Formel enthaelt ' || target.Object_Name || '(' AS Detail_Text
  FROM ObjectCatalog target
  JOIN LayoutObjects lo
    ON lo.File_Name = target.File_Name
   AND contains(
     lower(replace(
       COALESCE(lo.Hide_Calculation_Text, '') || ' ' ||
       COALESCE(lo.Tooltip_Calculation_Text, '') || ' ' ||
       COALESCE(lo.Label_Calculation_Text, '') || ' ' ||
       COALESCE(lo.ScriptTrigger_Parameter_Text, ''),
       ' ',
       ''
     )),
     lower(target.Object_Name || '(')
   )
  LEFT JOIN Layouts l
    ON l.L_ID = lo.Layout_ID
   AND l.File_Name = lo.File_Name
  WHERE target.Object_Type = 'CustomFunction'
)
SELECT DISTINCT *
FROM (
  SELECT * FROM step_ref_usage
  UNION ALL
  SELECT * FROM operational_link_usage
  UNION ALL
  SELECT * FROM custom_function_usage
) usage
WHERE Target_UUID IS NOT NULL
  AND Target_File IS NOT NULL;

CREATE TABLE ObjectUsageSummary AS
WITH supported_types(Object_Type) AS (
  VALUES
    ('Script'),
    ('Layout'),
    ('CustomFunction'),
    ('ValueList'),
    ('Field'),
    ('BaseTable')
),
usage_counts AS (
  SELECT Target_UUID, Target_File, COUNT(*) AS Usage_Count
  FROM ObjectUsageDetails
  GROUP BY Target_UUID, Target_File
),
usage_group_counts AS (
  SELECT
    Target_UUID,
    Target_File,
    string_agg(Usage_Category || ':' || CAST(category_count AS VARCHAR), '|' ORDER BY category_count DESC, Usage_Category) AS Usage_Groups
  FROM (
    SELECT Target_UUID, Target_File, Usage_Category, COUNT(*) AS category_count
    FROM ObjectUsageDetails
    GROUP BY Target_UUID, Target_File, Usage_Category
  ) g
  GROUP BY Target_UUID, Target_File
)
SELECT
  oc.Object_UUID,
  oc.Object_Type,
  oc.Object_Name,
  oc.File_Name,
  oc.Source_Table,
  oc.Object_ID,
  COALESCE(uc.Usage_Count, 0) AS Usage_Count,
  COALESCE(gc.Usage_Groups, '') AS Usage_Groups
FROM ObjectCatalog oc
JOIN supported_types st
  ON st.Object_Type = oc.Object_Type
LEFT JOIN usage_counts uc
  ON uc.Target_UUID = oc.Object_UUID
 AND uc.Target_File = oc.File_Name
LEFT JOIN usage_group_counts gc
  ON gc.Target_UUID = oc.Object_UUID
 AND gc.Target_File = oc.File_Name;

CREATE INDEX IF NOT EXISTS idx_object_usage_summary_uuid ON ObjectUsageSummary(Object_UUID);
CREATE INDEX IF NOT EXISTS idx_object_usage_summary_type ON ObjectUsageSummary(Object_Type);
CREATE INDEX IF NOT EXISTS idx_object_usage_summary_file ON ObjectUsageSummary(File_Name);
CREATE INDEX IF NOT EXISTS idx_object_usage_summary_count ON ObjectUsageSummary(Usage_Count);
CREATE INDEX IF NOT EXISTS idx_object_usage_details_target ON ObjectUsageDetails(Target_UUID, Target_File);
CREATE INDEX IF NOT EXISTS idx_object_usage_details_category ON ObjectUsageDetails(Usage_Category);
