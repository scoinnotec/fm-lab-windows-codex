-- @template_type: report
-- @description: Object references per script step
-- @params: uuid (required)
-- @author: Marcel
-- @version: 1.0
-- @tags: scripts, references, tokens

SELECT
  CAST(Step_Index AS INTEGER) AS line_index,
  Ref_Type AS type,
  Ref_Name AS name,
  Ref_UUID AS uuid
FROM XMLStepReferences
WHERE Script_UUID = getvariable('uuid')
ORDER BY CAST(Step_Index AS INTEGER), Ref_Type, Ref_Name;
