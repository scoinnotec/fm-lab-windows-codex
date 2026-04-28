-- @template_type: object
-- @description: Find all fields that are not used in any layout
-- @params: file (optional)
-- @output_format: uuid, name, type, table_name, field_type, file
-- @author: Marcel
-- @version: 1.1
-- @tags: fields, analysis, unused

SELECT
    oc.Object_UUID as uuid,
    oc.Object_Name as name,
    oc.Object_Type as type,
    f.Table_Name as table_name,
    f.Field_Type as field_type,
    oc.File_Name as file
FROM ObjectCatalog oc
JOIN FieldsForTables f ON oc.Object_UUID = f.Field_UUID
WHERE oc.Object_Type = 'Field'
  AND NOT EXISTS (
    SELECT 1 FROM ObjectLinks ol
    WHERE ol.Target_UUID = oc.Object_UUID
    AND ol.Link_Role = 'displays_field'
  )
  AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file'))
ORDER BY oc.Object_Name;
