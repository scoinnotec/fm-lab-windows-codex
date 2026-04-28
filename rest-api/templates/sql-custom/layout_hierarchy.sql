-- @template_type: report
-- @description: Nested layout object structure (Portal, Tab, Group hierarchy)
-- @params: name (required - layout name)
-- @output_format: source_uuid, source_name, source_type, target_uuid, target_name, target_type
-- @mermaid_compatible: true
-- @mermaid_direction: TD
-- @author: Marcel
-- @version: 2.0
-- @tags: layouts, objects, hierarchy, graph, mermaid

WITH RECURSIVE layout_tree AS (
  -- Top-level objects
  SELECT
    l.L_UUID as layout_uuid,
    l.L_Name as layout_name,
    lo.Object_UUID,
    lo.Object_Name,
    lo.Object_Type,
    lo.Parent_Object_ID,
    lo.Object_ID,
    lo.Layout_ID
  FROM LayoutObjects lo
  JOIN Layouts l ON lo.Layout_ID = l.L_ID
  WHERE l.L_Name = getvariable('name')
    AND lo.Parent_Object_ID IS NULL

  UNION ALL

  -- Child objects
  SELECT
    lt.layout_uuid,
    lt.layout_name,
    child.Object_UUID,
    child.Object_Name,
    child.Object_Type,
    child.Parent_Object_ID,
    child.Object_ID,
    child.Layout_ID
  FROM LayoutObjects child
  JOIN layout_tree lt ON child.Parent_Object_ID = lt.Object_ID
    AND child.Layout_ID = lt.Layout_ID
)
-- Edges: Parent → Child
SELECT
  COALESCE(parent.Object_UUID, lt.layout_uuid) as source_uuid,
  COALESCE(parent.Object_Name, 'Layout: ' || lt.layout_name) as source_name,
  COALESCE(parent.Object_Type, 'Layout') as source_type,
  lt.Object_UUID as target_uuid,
  COALESCE(lt.Object_Name, lt.Object_Type) as target_name,
  lt.Object_Type as target_type,
  'contains' as edge_label
FROM layout_tree lt
LEFT JOIN layout_tree parent ON lt.Parent_Object_ID = parent.Object_ID
ORDER BY source_name, target_name;
