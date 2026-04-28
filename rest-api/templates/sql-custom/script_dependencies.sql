-- @template_type: report
-- @description: Bidirectional script call graph (parents and children)
-- @params: uuid (required), depth (optional, default: 3)
-- @output_format: source_uuid, source_name, source_type, target_uuid, target_name, target_type, edge_label
-- @mermaid_compatible: true
-- @mermaid_direction: TD
-- @author: Marcel
-- @version: 2.3
-- @tags: scripts, dependencies, graph, mermaid, bidirectional

WITH RECURSIVE
-- Recursive CTE: Scripts die das Ziel-Script aufrufen (Parents / nach oben)
script_parents AS (
  -- Base: Start-Script
  SELECT
    oc.Object_UUID,
    oc.Object_Name,
    oc.Object_Type,
    0 as depth,
    oc.Object_UUID as root_uuid
  FROM ObjectCatalog oc
  WHERE oc.Object_UUID = getvariable('uuid')
    AND oc.Object_Type = 'Script'

  UNION ALL

  -- Recursive: Scripts die dieses Script aufrufen (nach oben)
  SELECT
    oc_caller.Object_UUID,
    oc_caller.Object_Name,
    oc_caller.Object_Type,
    sp.depth - 1 as depth,  -- Negative depth für Parents
    sp.root_uuid
  FROM script_parents sp
  JOIN ObjectLinks ol ON sp.Object_UUID = ol.Target_UUID
    AND ol.Link_Role = 'calls_script'
    AND ol.Link_Type = 'operational'
    AND ol.Source_Type = 'Script'
    AND ol.Target_Type = 'Script'
  JOIN ObjectCatalog oc_caller ON ol.Source_UUID = oc_caller.Object_UUID
    AND oc_caller.Object_Type = 'Script'
  WHERE sp.depth > -COALESCE(CAST(getvariable('depth') AS INTEGER), 3)
),

-- Recursive CTE: Scripts die vom Ziel-Script aufgerufen werden (Children / nach unten)
script_children AS (
  -- Base: Start-Script
  SELECT
    oc.Object_UUID,
    oc.Object_Name,
    oc.Object_Type,
    0 as depth,
    oc.Object_UUID as root_uuid
  FROM ObjectCatalog oc
  WHERE oc.Object_UUID = getvariable('uuid')
    AND oc.Object_Type = 'Script'

  UNION ALL

  -- Recursive: Scripts die von diesem Script aufgerufen werden (nach unten)
  SELECT
    oc_called.Object_UUID,
    oc_called.Object_Name,
    oc_called.Object_Type,
    sc.depth + 1 as depth,  -- Positive depth für Children
    sc.root_uuid
  FROM script_children sc
  JOIN ObjectLinks ol ON sc.Object_UUID = ol.Source_UUID
    AND ol.Link_Role = 'calls_script'
    AND ol.Link_Type = 'operational'
    AND ol.Source_Type = 'Script'
    AND ol.Target_Type = 'Script'
  JOIN ObjectCatalog oc_called ON ol.Target_UUID = oc_called.Object_UUID
    AND oc_called.Object_Type = 'Script'
  WHERE sc.depth < COALESCE(CAST(getvariable('depth') AS INTEGER), 3)
)

-- Edges für Parents (nach oben)
SELECT DISTINCT
  caller.Object_UUID as source_uuid,
  caller.Object_Name as source_name,
  caller.Object_Type as source_type,
  called.Object_UUID as target_uuid,
  called.Object_Name as target_name,
  called.Object_Type as target_type,
  'calls' as edge_label
FROM script_parents caller
JOIN ObjectLinks ol ON caller.Object_UUID = ol.Source_UUID
  AND ol.Link_Role = 'calls_script'
  AND ol.Link_Type = 'operational'
  AND ol.Source_Type = 'Script'
  AND ol.Target_Type = 'Script'
JOIN script_parents called ON ol.Target_UUID = called.Object_UUID

UNION

-- Edges für Children (nach unten)
SELECT DISTINCT
  caller.Object_UUID as source_uuid,
  caller.Object_Name as source_name,
  caller.Object_Type as source_type,
  called.Object_UUID as target_uuid,
  called.Object_Name as target_name,
  called.Object_Type as target_type,
  'calls' as edge_label
FROM script_children caller
JOIN ObjectLinks ol ON caller.Object_UUID = ol.Source_UUID
  AND ol.Link_Role = 'calls_script'
  AND ol.Link_Type = 'operational'
  AND ol.Source_Type = 'Script'
  AND ol.Target_Type = 'Script'
JOIN script_children called ON ol.Target_UUID = called.Object_UUID

ORDER BY source_name, target_name;
