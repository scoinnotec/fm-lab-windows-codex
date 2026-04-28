-- @template_type: report
-- @description: Find a script with both parent and child connections
-- @params: none

WITH script_stats AS (
  SELECT
    s.Object_UUID as uuid,
    s.Object_Name as name,
    COUNT(DISTINCT CASE WHEN ol_out.Target_UUID IS NOT NULL THEN ol_out.Target_UUID END) as children_count,
    COUNT(DISTINCT CASE WHEN ol_in.Source_UUID IS NOT NULL THEN ol_in.Source_UUID END) as parents_count
  FROM ObjectCatalog s
  LEFT JOIN ObjectLinks ol_out ON s.Object_UUID = ol_out.Source_UUID
    AND ol_out.Link_Role = 'calls_script'
    AND ol_out.Source_Type = 'Script'
    AND ol_out.Target_Type = 'Script'
  LEFT JOIN ObjectLinks ol_in ON s.Object_UUID = ol_in.Target_UUID
    AND ol_in.Link_Role = 'calls_script'
    AND ol_in.Source_Type = 'Script'
    AND ol_in.Target_Type = 'Script'
  WHERE s.Object_Type = 'Script'
  GROUP BY s.Object_UUID, s.Object_Name
  HAVING children_count > 0 OR parents_count > 0
)
SELECT
  uuid,
  name,
  children_count,
  parents_count,
  (children_count + parents_count) as total_connections
FROM script_stats
WHERE children_count > 0 AND parents_count > 0
ORDER BY total_connections DESC
LIMIT 5;
