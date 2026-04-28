-- @template_type: report
-- @description: Test query to understand script link structure
-- @params: none

SELECT
  ol.Source_Type,
  ol.Target_Type,
  ol.Link_Role,
  ol.Link_Type,
  COUNT(*) as count
FROM ObjectLinks ol
WHERE ol.Link_Role = 'calls_script'
GROUP BY ol.Source_Type, ol.Target_Type, ol.Link_Role, ol.Link_Type
ORDER BY count DESC;
