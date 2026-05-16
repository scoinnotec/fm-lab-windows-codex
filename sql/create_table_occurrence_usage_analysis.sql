-- ============================================
-- create_table_occurrence_usage_analysis.sql
-- ============================================
-- Precomputed usage analysis for FileMaker table occurrences.
--
-- Why this exists:
-- Live TO usage scans are too expensive because formula-like text columns
-- must be searched for literal "TO::" references. This file materializes the
-- analysis after import so the REST API can answer in milliseconds.
--
-- Sources included:
--   - layout context
--   - portals
--   - value lists
--   - lookups
--   - script XML references
--   - script calculation text
--   - field calculations
--   - auto-enter calculations
--   - custom function calculations
--   - layout object calculations and merge text
--   - relationship graph references

SET threads=4;
SET preserve_insertion_order=false;

DROP TABLE IF EXISTS TableOccurrenceUsageSummary;
DROP TABLE IF EXISTS TableOccurrenceUsageDetails;
DROP TABLE IF EXISTS TableOccurrenceRelationshipDetails;

-- --------------------------------------------
-- Functional usage details
-- --------------------------------------------
CREATE TABLE TableOccurrenceUsageDetails AS
WITH functional_usage AS (
  SELECT
    toc.TO_UUID AS Target_TO_UUID,
    toc.File_Name AS Target_File,
    'Layout-Kontext' AS Usage_Category,
    'functional' AS Usage_Family,
    'Layout' AS Source_Type,
    l.L_UUID AS Source_UUID,
    l.L_Name AS Source_Name,
    NULL::INTEGER AS Step_Number,
    l.L_Name AS Source_Location,
    'Layout basiert auf diesem TO' AS Detail_Text
  FROM TableOccurrenceCatalog toc
  JOIN Layouts l
    ON lower(l.L_TO_Name) = lower(toc.TO_Name)
   AND l.File_Name = toc.File_Name
  WHERE l.L_UUID IS NOT NULL

  UNION ALL

  SELECT
    xlr.Ref_UUID AS Target_TO_UUID,
    xlr.File_Name AS Target_File,
    'Portal' AS Usage_Category,
    'functional' AS Usage_Family,
    'LayoutObject' AS Source_Type,
    lo.Object_UUID AS Source_UUID,
    COALESCE(lo.Object_Name, lo.Object_Type, 'LayoutObject') AS Source_Name,
    NULL::INTEGER AS Step_Number,
    COALESCE(l.L_Name || ' / ' || COALESCE(lo.Object_Name, lo.Object_Type), COALESCE(lo.Object_Name, lo.Object_Type)) AS Source_Location,
    'Portal-Datenquelle' AS Detail_Text
  FROM XMLLayoutReferences xlr
  LEFT JOIN LayoutObjects lo
    ON lo.Object_UUID = xlr.Object_UUID
   AND lo.File_Name = xlr.File_Name
  LEFT JOIN Layouts l
    ON l.L_ID = lo.Layout_ID
   AND l.File_Name = lo.File_Name
  WHERE xlr.Ref_Type = 'table_occurrence'
    AND xlr.Ref_UUID IS NOT NULL

  UNION ALL

  SELECT
    ovl.TO_UUID AS Target_TO_UUID,
    ovl.File_Name AS Target_File,
    'Werteliste' AS Usage_Category,
    'functional' AS Usage_Family,
    'ValueList' AS Source_Type,
    ovl.VL_UUID AS Source_UUID,
    ovl.VL_Name AS Source_Name,
    NULL::INTEGER AS Step_Number,
    ovl.VL_Name AS Source_Location,
    COALESCE('Feld: ' || ovl.Field_Name, 'TO-basierte Werteliste') AS Detail_Text
  FROM OptionsForValueLists ovl
  WHERE ovl.TO_UUID IS NOT NULL

  UNION ALL

  SELECT
    f.Lookup_TO_UUID AS Target_TO_UUID,
    f.File_Name AS Target_File,
    'Lookup' AS Usage_Category,
    'functional' AS Usage_Family,
    'Field' AS Source_Type,
    f.Field_UUID AS Source_UUID,
    f.Table_Name || '::' || f.Field_Name AS Source_Name,
    NULL::INTEGER AS Step_Number,
    f.Table_Name || '::' || f.Field_Name AS Source_Location,
    COALESCE('Lookup-Quelle: ' || f.Lookup_Field_Name, 'Auto-Enter Lookup') AS Detail_Text
  FROM FieldsForTables f
  WHERE f.Lookup_TO_UUID IS NOT NULL

  UNION ALL

  SELECT
    CASE WHEN xsr.Ref_Type = 'tableOccurrence' THEN xsr.Ref_UUID ELSE xsr.TO_UUID END AS Target_TO_UUID,
    xsr.File_Name AS Target_File,
    'Script' AS Usage_Category,
    'functional' AS Usage_Family,
    'Script' AS Source_Type,
    COALESCE(s.Script_UUID, xsr.Script_UUID) AS Source_UUID,
    COALESCE(s.Script_Name, 'Script') AS Source_Name,
    COALESCE(s.Step_Index + 1, TRY_CAST(xsr.Step_Index AS INTEGER) + 1) AS Step_Number,
    COALESCE(s.Script_Name, 'Script') || ' [Schritt ' ||
      CAST(COALESCE(s.Step_Index + 1, TRY_CAST(xsr.Step_Index AS INTEGER) + 1) AS VARCHAR) ||
      '] ' || COALESCE(s.Step_Name, xsr.Step_Name, '') AS Source_Location,
    CASE
      WHEN xsr.Ref_Type = 'field' THEN COALESCE(xsr.TO_Name, '') || '::' || COALESCE(xsr.Ref_Name, '')
      ELSE COALESCE(xsr.Ref_Name, xsr.TO_Name, '')
    END AS Detail_Text
  FROM XMLStepReferences xsr
  LEFT JOIN StepsForScripts s
    ON s.Step_UUID = xsr.Step_UUID
   AND s.File_Name = xsr.File_Name
  WHERE CASE WHEN xsr.Ref_Type = 'tableOccurrence' THEN xsr.Ref_UUID ELSE xsr.TO_UUID END IS NOT NULL

  UNION ALL

  SELECT
    toc.TO_UUID AS Target_TO_UUID,
    toc.File_Name AS Target_File,
    'Script-Formel' AS Usage_Category,
    'functional' AS Usage_Family,
    'Script' AS Source_Type,
    s.Script_UUID AS Source_UUID,
    s.Script_Name AS Source_Name,
    s.Step_Index + 1 AS Step_Number,
    s.Script_Name || ' [Schritt ' || CAST(s.Step_Index + 1 AS VARCHAR) || '] ' || COALESCE(s.Step_Name, '') AS Source_Location,
    'Script-Formel enthaelt ' || toc.TO_Name || '::' AS Detail_Text
  FROM TableOccurrenceCatalog toc
  JOIN StepsForScripts s
    ON s.File_Name = toc.File_Name
   AND contains(lower(COALESCE(s.Calculation_Text, '')), lower(toc.TO_Name || '::'))

  UNION ALL

  SELECT
    toc.TO_UUID AS Target_TO_UUID,
    toc.File_Name AS Target_File,
    'Feld-Berechnung' AS Usage_Category,
    'functional' AS Usage_Family,
    'Field' AS Source_Type,
    f.Field_UUID AS Source_UUID,
    f.Table_Name || '::' || f.Field_Name AS Source_Name,
    NULL::INTEGER AS Step_Number,
    f.Table_Name || '::' || f.Field_Name AS Source_Location,
    'Formel enthaelt ' || toc.TO_Name || '::' AS Detail_Text
  FROM TableOccurrenceCatalog toc
  JOIN FieldsForTables f
    ON f.File_Name = toc.File_Name
   AND contains(lower(COALESCE(f.Calculation_Text, '')), lower(toc.TO_Name || '::'))

  UNION ALL

  SELECT
    toc.TO_UUID AS Target_TO_UUID,
    toc.File_Name AS Target_File,
    'Auto-Enter' AS Usage_Category,
    'functional' AS Usage_Family,
    'Field' AS Source_Type,
    f.Field_UUID AS Source_UUID,
    f.Table_Name || '::' || f.Field_Name AS Source_Name,
    NULL::INTEGER AS Step_Number,
    f.Table_Name || '::' || f.Field_Name AS Source_Location,
    'Auto-Enter-Formel enthaelt ' || toc.TO_Name || '::' AS Detail_Text
  FROM TableOccurrenceCatalog toc
  JOIN FieldsForTables f
    ON f.File_Name = toc.File_Name
   AND contains(lower(COALESCE(f.AE_Calc_Text, '')), lower(toc.TO_Name || '::'))

  UNION ALL

  SELECT
    toc.TO_UUID AS Target_TO_UUID,
    toc.File_Name AS Target_File,
    'Custom Function' AS Usage_Category,
    'functional' AS Usage_Family,
    'CustomFunction' AS Source_Type,
    cf.CF_UUID AS Source_UUID,
    cf.CF_Name AS Source_Name,
    NULL::INTEGER AS Step_Number,
    cf.CF_Name AS Source_Location,
    'Custom Function enthaelt ' || toc.TO_Name || '::' AS Detail_Text
  FROM TableOccurrenceCatalog toc
  JOIN CalcsForCustomFunctions cf
    ON cf.File_Name = toc.File_Name
   AND contains(lower(COALESCE(cf.Calculation_Code, '')), lower(toc.TO_Name || '::'))

  UNION ALL

  SELECT
    toc.TO_UUID AS Target_TO_UUID,
    toc.File_Name AS Target_File,
    'Layout-Formel' AS Usage_Category,
    'functional' AS Usage_Family,
    'LayoutObject' AS Source_Type,
    lo.Object_UUID AS Source_UUID,
    COALESCE(lo.Object_Name, lo.Object_Type, 'LayoutObject') AS Source_Name,
    NULL::INTEGER AS Step_Number,
    COALESCE(l.L_Name || ' / ' || COALESCE(lo.Object_Name, lo.Object_Type), COALESCE(lo.Object_Name, lo.Object_Type)) AS Source_Location,
    'Layout-Objekt-Formel enthaelt ' || toc.TO_Name || '::' AS Detail_Text
  FROM TableOccurrenceCatalog toc
  JOIN LayoutObjects lo
    ON lo.File_Name = toc.File_Name
   AND contains(
     lower(
       COALESCE(lo.Hide_Calculation_Text, '') || ' ' ||
       COALESCE(lo.Tooltip_Calculation_Text, '') || ' ' ||
       COALESCE(lo.Label_Calculation_Text, '') || ' ' ||
       COALESCE(lo.ScriptTrigger_Parameter_Text, '')
     ),
     lower(toc.TO_Name || '::')
   )
  LEFT JOIN Layouts l
    ON l.L_ID = lo.Layout_ID
   AND l.File_Name = lo.File_Name

  UNION ALL

  SELECT
    toc.TO_UUID AS Target_TO_UUID,
    toc.File_Name AS Target_File,
    'Layout-Text' AS Usage_Category,
    'functional' AS Usage_Family,
    'LayoutObject' AS Source_Type,
    lo.Object_UUID AS Source_UUID,
    COALESCE(lo.Object_Name, lo.Object_Type, 'LayoutObject') AS Source_Name,
    NULL::INTEGER AS Step_Number,
    COALESCE(l.L_Name || ' / ' || COALESCE(lo.Object_Name, lo.Object_Type), COALESCE(lo.Object_Name, lo.Object_Type)) AS Source_Location,
    'Layout-Text enthaelt ' || toc.TO_Name || '::' AS Detail_Text
  FROM TableOccurrenceCatalog toc
  JOIN LayoutObjects lo
    ON lo.File_Name = toc.File_Name
   AND contains(lower(COALESCE(lo.Text_Content, '')), lower(toc.TO_Name || '::'))
  LEFT JOIN Layouts l
    ON l.L_ID = lo.Layout_ID
   AND l.File_Name = lo.File_Name
)
SELECT DISTINCT *
FROM functional_usage
WHERE Target_TO_UUID IS NOT NULL
  AND Target_File IS NOT NULL;

-- --------------------------------------------
-- Relationship usage details
-- --------------------------------------------
CREATE TABLE TableOccurrenceRelationshipDetails AS
SELECT DISTINCT *
FROM (
  SELECT
    rc.Left_TO_UUID AS Target_TO_UUID,
    rc.File_Name AS Target_File,
    'Beziehung links' AS Usage_Category,
    'relationship' AS Usage_Family,
    'Relationship' AS Source_Type,
    rc.Rel_ID::VARCHAR || '_' || rc.File_Name AS Source_UUID,
    rc.Left_TO_Name || ' = ' || rc.Right_TO_Name AS Source_Name,
    NULL::INTEGER AS Step_Number,
    rc.Left_TO_Name || ' -> ' || rc.Right_TO_Name AS Source_Location,
    COALESCE(rc.Left_Field_Name, '') || ' ' || COALESCE(rc.Operator, '') || ' ' || COALESCE(rc.Right_Field_Name, '') AS Detail_Text
  FROM RelationshipCatalog rc
  WHERE rc.Left_TO_UUID IS NOT NULL

  UNION ALL

  SELECT
    rc.Right_TO_UUID AS Target_TO_UUID,
    rc.File_Name AS Target_File,
    'Beziehung rechts' AS Usage_Category,
    'relationship' AS Usage_Family,
    'Relationship' AS Source_Type,
    rc.Rel_ID::VARCHAR || '_' || rc.File_Name AS Source_UUID,
    rc.Left_TO_Name || ' = ' || rc.Right_TO_Name AS Source_Name,
    NULL::INTEGER AS Step_Number,
    rc.Left_TO_Name || ' -> ' || rc.Right_TO_Name AS Source_Location,
    COALESCE(rc.Left_Field_Name, '') || ' ' || COALESCE(rc.Operator, '') || ' ' || COALESCE(rc.Right_Field_Name, '') AS Detail_Text
  FROM RelationshipCatalog rc
  WHERE rc.Right_TO_UUID IS NOT NULL
) relationship_usage
WHERE Target_TO_UUID IS NOT NULL
  AND Target_File IS NOT NULL;

-- --------------------------------------------
-- Summary per TO
-- --------------------------------------------
CREATE TABLE TableOccurrenceUsageSummary AS
WITH all_usage AS (
  SELECT * FROM TableOccurrenceUsageDetails
  UNION ALL
  SELECT * FROM TableOccurrenceRelationshipDetails
),
functional_counts AS (
  SELECT Target_TO_UUID, Target_File, COUNT(*) AS Functional_Usage_Count
  FROM TableOccurrenceUsageDetails
  GROUP BY Target_TO_UUID, Target_File
),
relationship_counts AS (
  SELECT Target_TO_UUID, Target_File, COUNT(*) AS Relationship_Count
  FROM TableOccurrenceRelationshipDetails
  GROUP BY Target_TO_UUID, Target_File
),
usage_group_counts AS (
  SELECT
    Target_TO_UUID,
    Target_File,
    string_agg(Usage_Category || ':' || CAST(category_count AS VARCHAR), '|' ORDER BY category_count DESC, Usage_Category) AS Usage_Groups
  FROM (
    SELECT Target_TO_UUID, Target_File, Usage_Category, COUNT(*) AS category_count
    FROM all_usage
    GROUP BY Target_TO_UUID, Target_File, Usage_Category
  ) g
  GROUP BY Target_TO_UUID, Target_File
)
SELECT
  toc.TO_UUID,
  toc.TO_Name,
  toc.File_Name,
  toc.BT_Name,
  toc.DS_Name,
  COALESCE(fc.Functional_Usage_Count, 0) + COALESCE(rc.Relationship_Count, 0) AS Usage_Count,
  COALESCE(fc.Functional_Usage_Count, 0) AS Functional_Usage_Count,
  COALESCE(rc.Relationship_Count, 0) AS Relationship_Count,
  COALESCE(gc.Usage_Groups, '') AS Usage_Groups
FROM TableOccurrenceCatalog toc
LEFT JOIN functional_counts fc
  ON fc.Target_TO_UUID = toc.TO_UUID
 AND fc.Target_File = toc.File_Name
LEFT JOIN relationship_counts rc
  ON rc.Target_TO_UUID = toc.TO_UUID
 AND rc.Target_File = toc.File_Name
LEFT JOIN usage_group_counts gc
  ON gc.Target_TO_UUID = toc.TO_UUID
 AND gc.Target_File = toc.File_Name;

CREATE INDEX IF NOT EXISTS idx_to_usage_summary_to_uuid ON TableOccurrenceUsageSummary(TO_UUID);
CREATE INDEX IF NOT EXISTS idx_to_usage_summary_file ON TableOccurrenceUsageSummary(File_Name);
CREATE INDEX IF NOT EXISTS idx_to_usage_summary_count ON TableOccurrenceUsageSummary(Usage_Count);
CREATE INDEX IF NOT EXISTS idx_to_usage_details_target ON TableOccurrenceUsageDetails(Target_TO_UUID, Target_File);
CREATE INDEX IF NOT EXISTS idx_to_usage_details_category ON TableOccurrenceUsageDetails(Usage_Category);
CREATE INDEX IF NOT EXISTS idx_to_relationship_details_target ON TableOccurrenceRelationshipDetails(Target_TO_UUID, Target_File);
CREATE INDEX IF NOT EXISTS idx_to_relationship_details_category ON TableOccurrenceRelationshipDetails(Usage_Category);
