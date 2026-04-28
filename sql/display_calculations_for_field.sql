-- Display all calculation fields that reference a specific field
--
-- This template displays all FileMaker calculation fields (and custom functions)
-- that use a specific field in their formula.
-- Requires DDR-Info to be available in the XML export.
--
-- Usage:
--   duckdb db/fm_catalog.duckdb < sql/display_calculations_for_field.sql
--
-- To change the Field UUID, modify the SET VARIABLE field_uuid line below.
--
-- Current Field UUID: 3A3A13BC-8366-4981-8142-4BD69034A7A5 (Lieferanten::Index)

.mode box
.header on

SET VARIABLE field_uuid = '3A3A13BC-8366-4981-8142-4BD69034A7A5';  -- << Change this value to display calculations for different fields

-- Display field information
SELECT
    Field_ID,
    Table_Name || '::' || Field_Name as Field_Reference,
    Field_Type,
    Data_Type,
    Field_UUID
FROM FieldsForTables
WHERE Field_UUID = getvariable('field_uuid');

SELECT ''; -- Empty line for better readability

-- Check if DDR-Info is available
SELECT
    CASE
        WHEN (SELECT Has_DDR_INFO FROM XMLMetadata LIMIT 1) = 'True'
        THEN 'DDR-Info is available - showing calculation references'
        ELSE 'DDR-Info is NOT available - calculation analysis requires DDR-Info'
    END as Status;

SELECT ''; -- Empty line for better readability

-- Display calculation fields that reference this field
SELECT
    f.Table_Name || '::' || f.Field_Name as Calculated_Field,
    f.Field_Type,
    f.Data_Type,
    COUNT(DISTINCT ddr.Chunk_Index) as Chunk_References
FROM FieldsForTables f
JOIN DDR_Calculations ddr ON f.DDR_Hash = ddr.Calc_Hash
WHERE f.Field_Type = 'Calculated'
  AND ddr.Chunk_Content LIKE '%"@UUID":"' || getvariable('field_uuid') || '"%'
  AND ddr.Chunk_Content LIKE '%"@type":"FieldRef"%'
GROUP BY f.Table_Name, f.Field_Name, f.Field_Type, f.Data_Type, f.Field_UUID
ORDER BY f.Table_Name, f.Field_Name;

SELECT ''; -- Empty line for better readability

-- Display custom functions that reference this field
SELECT
    cf.CF_Name as Function_Name,
    COUNT(DISTINCT ddr.Chunk_Index) as Chunk_References
FROM CustomFunctionsCatalog cf
JOIN CalcsForCustomFunctions calc ON cf.CF_UUID = calc.CF_UUID
JOIN DDR_Calculations ddr ON calc.DDR_Hash = ddr.Calc_Hash
WHERE ddr.Chunk_Content LIKE '%"@UUID":"' || getvariable('field_uuid') || '"%'
  AND ddr.Chunk_Content LIKE '%"@type":"FieldRef"%'
GROUP BY cf.CF_Name, cf.CF_UUID
ORDER BY cf.CF_Name;
