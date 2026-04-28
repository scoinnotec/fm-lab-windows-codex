-- Top Object Count Report
-- Shows Top 10 contexts for key object categories
--
-- This template provides:
-- - Top 10 Base Tables with most fields
-- - Top 10 Layouts with most fields
-- - Top 10 Layouts with most objects
-- - Top 10 Scripts with most steps
--
-- Usage:
--   duckdb db/fm_catalog.duckdb < sql/report_file_objects_topcount.sql
--
-- To change the FileMaker file, modify the SET VARIABLE file_name line below.
--
-- Current File: Artikel

.mode line
.header on

SET VARIABLE file_name = 'Artikel';  -- << Change this value to analyze different files
SET VARIABLE top_count = 10;

-- Display File Information Header
SELECT
    '========================================' as '',
    'Top Object Count Report' as '',
    '========================================' as '',
    'FileMaker File: ' || Filename as '',
    'FileMaker Version: ' || FileMaker_Version as '',
    'DDR Info Available: ' || Has_DDR_INFO as '',
    '========================================' as ''
FROM XMLMetadata
WHERE File_Name = getvariable('file_name');

.mode table
.header on

-- ============================================================================
-- TOP 10: Base Tables with Most Fields
-- ============================================================================
SELECT
    'Top ' || getvariable('top_count') || ': Base Tables with Most Fields' as 'Report';

SELECT
    b.BT_Name as Table_Name,
    COUNT(f.Field_ID) as Field_Count
FROM BaseTableCatalog b
LEFT JOIN FieldsForTables f ON b.BT_UUID = f.Table_UUID AND f.File_Name = getvariable('file_name')
WHERE b.File_Name = getvariable('file_name')
GROUP BY b.BT_UUID, b.BT_Name
ORDER BY Field_Count DESC
LIMIT getvariable('top_count');


-- ============================================================================
-- TOP 10: Layouts with Most Fields
-- ============================================================================
SELECT
    'Top ' || getvariable('top_count') || ': Layouts with Most Fields' as 'Report';

SELECT
    l.L_Name as Layout_Name,
    COUNT(DISTINCT lo.Object_UUID) as Field_Count
FROM Layouts l
LEFT JOIN LayoutObjects lo
    ON l.L_ID = lo.Layout_ID
    AND lo.File_Name = getvariable('file_name')
    AND lo.Object_Type IN ('Edit Box', 'Drop-down List', 'Pop-up Menu', 'Radio Button Set', 'Checkbox Set', 'Drop-down Calendar')
WHERE l.File_Name = getvariable('file_name')
GROUP BY l.L_ID, l.L_Name
ORDER BY Field_Count DESC
LIMIT getvariable('top_count');


-- ============================================================================
-- TOP 10: Layouts with Most Objects
-- ============================================================================
SELECT
    'Top ' || getvariable('top_count') || ': Layouts with Most Objects' as 'Report';

SELECT
    l.L_Name as Layout_Name,
    COUNT(lo.Object_UUID) as Object_Count
FROM Layouts l
LEFT JOIN LayoutObjects lo
    ON l.L_ID = lo.Layout_ID
    AND lo.File_Name = getvariable('file_name')
WHERE l.File_Name = getvariable('file_name')
GROUP BY l.L_ID, l.L_Name
ORDER BY Object_Count DESC
LIMIT getvariable('top_count');


-- ============================================================================
-- TOP 10: Scripts with Most Steps
-- ============================================================================
SELECT
    'Top ' || getvariable('top_count') || ': Scripts with Most Steps' as 'Report';

SELECT
    s.Script_Name,
    COUNT(st.Step_UUID) as Step_Count
FROM ScriptCatalog s
LEFT JOIN StepsForScripts st
    ON s.Script_UUID = st.Script_UUID
    AND st.File_Name = getvariable('file_name')
WHERE s.File_Name = getvariable('file_name')
  AND (s.Folder_Type IS NULL OR s.Folder_Type = 'False')
  AND NOT s.Is_Separator
GROUP BY s.Script_UUID, s.Script_Name
ORDER BY Step_Count DESC
LIMIT getvariable('top_count');
