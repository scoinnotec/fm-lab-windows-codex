-- @template_type: report
-- @description: Cross-file dependencies between FileMaker files
-- @params: none
-- @output_format: source_uuid, source_name, target_uuid, target_name, edge_label
-- @mermaid_compatible: true
-- @mermaid_direction: LR
-- @author: Marcel
-- @version: 2.0
-- @tags: files, dependencies, graph, mermaid

SELECT
  oc_s.File_Name as source_uuid,
  oc_s.File_Name as source_name,
  'File' as source_type,
  oc_t.File_Name as target_uuid,
  oc_t.File_Name as target_name,
  'File' as target_type,
  COUNT(*) || ' links' as edge_label
FROM ObjectLinks ol
JOIN ObjectCatalog oc_s ON ol.Source_UUID = oc_s.Object_UUID
JOIN ObjectCatalog oc_t ON ol.Target_UUID = oc_t.Object_UUID
WHERE ol.Is_Cross_File = TRUE
  AND ol.Link_Type = 'operational'
GROUP BY oc_s.File_Name, oc_t.File_Name
ORDER BY COUNT(*) DESC;
