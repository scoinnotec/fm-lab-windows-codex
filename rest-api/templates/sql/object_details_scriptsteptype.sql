-- @template_type: content
-- @description: Detail view of an aggregated ScriptStep type — all callers across all scripts
-- @params: uuid (required)
-- @output_format: content
-- @author: Marcel
-- @version: 1.0
-- @tags: scriptsteptype, details, aggregate
-- @note: Synthetic ObjectCatalog entry — Object_Name = 'Set Variable', 'Go to Layout', etc.
--        Aggregates step instances from StepsForScripts (no ObjectLinks-Spiegelung, PRD §6.4).

WITH self AS (
  SELECT Object_UUID, Object_Type, Object_Name, Source_Table
  FROM ObjectCatalog
  WHERE Object_UUID = getvariable('uuid')
    AND Object_Type = 'ScriptStepType'
  LIMIT 1
),
instances AS (
  SELECT
    s.Script_UUID,
    s.Script_Name,
    s.File_Name,
    s.Step_Index,
    s.Step_Name,
    s.DDR_UUID
  FROM StepsForScripts s
  JOIN self t ON s.Step_Name = t.Object_Name
),
caller_summary AS (
  SELECT
    Script_UUID,
    Script_Name,
    File_Name,
    COUNT(*) as Step_Count,
    MIN(Step_Index) as First_Index
  FROM instances
  GROUP BY Script_UUID, Script_Name, File_Name
),
total_count AS (
  SELECT COUNT(*) as total FROM instances
)

SELECT content FROM (
  -- Header
  SELECT 1 as sort_key, 0 as sub_key,
    '=== ScriptStep Type Details ===' as content
  FROM self

  UNION ALL
  SELECT 2, 0, '' FROM self

  UNION ALL

  -- Properties
  SELECT 3, 1, 'Step Name:    ' || s.Object_Name FROM self s
  UNION ALL
  SELECT 3, 2, 'Type:         ScriptStepType' FROM self
  UNION ALL
  SELECT 3, 3, 'Scope:        Solution-wide (lösungs-unabhängig)' FROM self
  UNION ALL
  SELECT 3, 4, 'Total Usages: ' || CAST((SELECT total FROM total_count) AS VARCHAR) FROM self

  UNION ALL

  -- Usage Summary
  SELECT 5, 0, '' WHERE (SELECT COUNT(*) FROM caller_summary) > 0
  UNION ALL
  SELECT 5, 1,
    '--- Usage Summary --- ('
    || CAST((SELECT COUNT(*) FROM caller_summary) AS VARCHAR)
    || ' scripts, '
    || CAST((SELECT total FROM total_count) AS VARCHAR)
    || ' total steps)'
  WHERE (SELECT COUNT(*) FROM caller_summary) > 0

  UNION ALL

  -- Detailed script list
  SELECT 8, 0, '' WHERE (SELECT COUNT(*) FROM caller_summary) > 0
  UNION ALL
  SELECT 8, 1, '--- Scripts ---'
  WHERE (SELECT COUNT(*) FROM caller_summary) > 0
  UNION ALL
  SELECT 9, ROW_NUMBER() OVER (ORDER BY Step_Count DESC, Script_Name),
    '  <- Script: ' || Script_Name
    || ' [' || File_Name || ']'
    || ' (' || CAST(Step_Count AS VARCHAR) || ' step'
    || CASE WHEN Step_Count > 1 THEN 's' ELSE '' END
    || ')'
  FROM caller_summary
) details
ORDER BY sort_key, sub_key;
