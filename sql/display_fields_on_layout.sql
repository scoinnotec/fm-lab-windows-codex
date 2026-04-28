-- Display all fields on a specific layout
--
-- This template displays all field objects on a FileMaker layout
-- in the format TableOccurrence::FieldName with their object type.
--
-- Usage:
--   duckdb db/fm_catalog.duckdb < sql/display_fields_on_layout.sql
--
-- To change the Layout ID, modify the SET VARIABLE layout_id line below.
--
-- Current Layout ID: 339 (Stammdaten Verknüpfungen)

INSTALL webbed FROM community;
LOAD webbed;

.mode box
.header on

SET VARIABLE layout_id = 339;  -- << Change this value to display fields from different layouts

-- Display layout information
SELECT
    L_ID as Layout_ID,
    L_Name as Layout_Name
FROM Layouts
WHERE L_ID = getvariable('layout_id');

SELECT ''; -- Empty line for better readability

-- Display all fields on the layout
SELECT
    xml_extract_text(Object_XML, '/LayoutObject/Field/FieldReference/TableOccurrenceReference/@name')[1] || '::' ||
    xml_extract_text(Object_XML, '/LayoutObject/Field/FieldReference/@name')[1] as Field_Reference,
    Object_Type,
    CASE
        WHEN xml_extract_text(Object_XML, '/LayoutObject/Field/Display/ValueListReference/@name')[1] IS NOT NULL
        THEN xml_extract_text(Object_XML, '/LayoutObject/Field/Display/ValueListReference/@name')[1]
        ELSE ''
    END as Value_List
FROM LayoutObjects
WHERE Layout_ID = getvariable('layout_id')
  AND Object_Type IN ('Edit Box', 'Drop-down List', 'Pop-up Menu', 'Radio Button Set', 'Checkbox Set', 'Drop-down Calendar')
  AND xml_extract_text(Object_XML, '/LayoutObject/Field/FieldReference/@name')[1] IS NOT NULL
ORDER BY Field_Reference;
