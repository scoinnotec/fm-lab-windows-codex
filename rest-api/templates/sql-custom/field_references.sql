-- @template_type: report
-- @description: Find all references to a specific field (includes ObjectLinks, Calculated Fields, and Custom Functions)
-- @params: name (required - field name with table, e.g. "Kunden::Email")
-- @output_format: source_uuid, source_name, source_type, target_uuid, target_name, target_type, edge_label
-- @mermaid_compatible: true
-- @mermaid_direction: LR
-- @author: Marcel
-- @version: 3.0
-- @tags: fields, references, graph, mermaid, ddr-hash

-- Part 1: ObjectLinks-based references (Scripts, Layouts, Relationships)
SELECT
  ol.Source_UUID as source_uuid,
  oc_source.Object_Name as source_name,
  oc_source.Object_Type as source_type,
  ol.Target_UUID as target_uuid,
  oc_field.Object_Name as target_name,
  oc_field.Object_Type as target_type,
  ol.Link_Role as edge_label
FROM ObjectCatalog oc_field
JOIN ObjectLinks ol ON oc_field.Object_UUID = ol.Target_UUID
JOIN ObjectCatalog oc_source ON ol.Source_UUID = oc_source.Object_UUID
WHERE oc_field.Object_Type = 'Field'
  AND oc_field.Object_Name = getvariable('name')
  AND ol.Link_Type = 'operational'

UNION

-- Part 2: DDR-Hash based - Calculated Fields that reference this field
-- Requires: DDR-Info (FileMaker 21+)
SELECT
  f.Field_UUID as source_uuid,
  f.Table_Name || '::' || f.Field_Name as source_name,
  'Field' as source_type,
  target.Field_UUID as target_uuid,
  target.Table_Name || '::' || target.Field_Name as target_name,
  'Field' as target_type,
  'uses_in_calculation' as edge_label
FROM FieldsForTables target
JOIN DDR_Calculations ddr ON ddr.Chunk_Content LIKE '%"@UUID":"' || target.Field_UUID || '"%'
                            AND ddr.Chunk_Content LIKE '%"@type":"FieldRef"%'
JOIN FieldsForTables f ON f.DDR_Hash = ddr.Calc_Hash
WHERE target.Table_Name || '::' || target.Field_Name = getvariable('name')
  AND f.Field_Type = 'Calculated'
  AND (SELECT Has_DDR_INFO FROM XMLMetadata LIMIT 1) = 'True'

UNION

-- Part 3: DDR-Hash based - Custom Functions that reference this field
-- Requires: DDR-Info (FileMaker 21+)
SELECT
  cf.CF_UUID as source_uuid,
  cf.CF_Name as source_name,
  'CustomFunction' as source_type,
  target.Field_UUID as target_uuid,
  target.Table_Name || '::' || target.Field_Name as target_name,
  'Field' as target_type,
  'uses_in_function' as edge_label
FROM FieldsForTables target
JOIN DDR_Calculations ddr ON ddr.Chunk_Content LIKE '%"@UUID":"' || target.Field_UUID || '"%'
                            AND ddr.Chunk_Content LIKE '%"@type":"FieldRef"%'
JOIN CustomFunctionsCatalog cf ON cf.DDR_Hash = ddr.Calc_Hash
WHERE target.Table_Name || '::' || target.Field_Name = getvariable('name')
  AND (SELECT Has_DDR_INFO FROM XMLMetadata LIMIT 1) = 'True'

ORDER BY source_type, source_name;
