-- Display all layouts where a specific field is used
--
-- This template displays all FileMaker layouts that contain a reference to
-- a specific field, filtered by the field's source table context.
--
-- Usage:
--   duckdb db/fm_catalog.duckdb < sql/display_layouts_for_field.sql
--
-- To change the Field UUID, modify the SET VARIABLE field_uuid line below.
--
-- Current Field UUID: AFEB8FB9-B55F-442C-A17A-1737A5F1E584 (Lieferanten::Referenzlisten Auswahl)

INSTALL webbed FROM community;
LOAD webbed;

.mode box
.header on

SET VARIABLE field_uuid = 'AFEB8FB9-B55F-442C-A17A-1737A5F1E584';  -- << Change this value to display layouts for different fields

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

-- Display all layouts where this field is used (filtered by table context)
SELECT
    l.L_Name as Layout_Name,
    l.L_TO_Name as Table_Context,
    lo.Object_Type,
    lo.Bounds_Top,
    lo.Bounds_Left,
    lo.Bounds_Bottom,
    lo.Bounds_Right,
    CASE
        WHEN xml_extract_text(lo.Object_XML, '/LayoutObject/Field/Display/ValueListReference/@name')[1] IS NOT NULL
        THEN xml_extract_text(lo.Object_XML, '/LayoutObject/Field/Display/ValueListReference/@name')[1]
        ELSE ''
    END as Value_List
FROM LayoutObjects lo
JOIN Layouts l ON lo.Layout_ID = l.L_ID
WHERE xml_extract_text(lo.Object_XML, '/LayoutObject/Field/FieldReference/@UUID')[1] = getvariable('field_uuid')
AND l.L_TO_Name = (
    SELECT Table_Name FROM FieldsForTables WHERE Field_UUID = getvariable('field_uuid')
)
ORDER BY l.L_Name;
