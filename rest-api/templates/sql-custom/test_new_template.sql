-- @template_type: report
-- @description: TEST - This is a new template created to test cache
-- @params: none
-- @version: 1.0

SELECT
  'TEST' as source_uuid,
  'Test Node' as source_name,
  'Script' as source_type,
  'TEST2' as target_uuid,
  'Test Target' as target_name,
  'Script' as target_type,
  'calls' as edge_label;
