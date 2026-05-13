-- @template_type: content
-- @description: Detail view of a built-in FileMaker function - callers aggregated by source type
-- @params: uuid (required)
-- @output_format: content
-- @author: Marcel
-- @version: 1.0
-- @tags: builtinfunction, details, ddr
-- @note: Synthetic ObjectCatalog entry — Object_Name = 'Case' / 'Get(LayoutName)'.
--        Aggregates callers from XMLCalcReferences (Ref_Type='function').

WITH self AS (
  SELECT Object_UUID, Object_Type, Object_Name, Source_Table
  FROM ObjectCatalog
  WHERE Object_UUID = getvariable('uuid')
    AND Object_Type = 'BuiltinFunction'
  LIMIT 1
),
callers AS (
  SELECT
    oc_src.Object_Type as Used_By_Type,
    oc_src.Object_Name as Used_By_Name,
    oc_src.File_Name as Used_By_File,
    ol.Link_Subrole,
    COUNT(*) as Call_Count
  FROM ObjectLinks ol
  JOIN ObjectCatalog oc_src ON ol.Source_UUID = oc_src.Object_UUID
  WHERE ol.Target_UUID = getvariable('uuid')
    AND ol.Link_Role = 'calls_function'
  GROUP BY oc_src.Object_Type, oc_src.Object_Name, oc_src.File_Name, ol.Link_Subrole
),
caller_type_counts AS (
  SELECT Used_By_Type, COUNT(*) as Type_Count
  FROM callers
  GROUP BY Used_By_Type
)

SELECT content FROM (
  -- Header
  SELECT 1 as sort_key, 0 as sub_key,
    '=== Built-in Function Details ===' as content
  FROM self

  UNION ALL
  SELECT 2, 0, '' FROM self

  UNION ALL

  -- Properties
  SELECT 3, 1, 'Function:     ' || s.Object_Name FROM self s
  UNION ALL
  SELECT 3, 2, 'Type:         BuiltinFunction' FROM self
  UNION ALL
  SELECT 3, 3, 'Scope:        FileMaker built-in (lösungs-unabhängig)' FROM self

  UNION ALL

  -- Usage summary
  SELECT 5, 0, '' WHERE (SELECT COUNT(*) FROM callers) > 0
  UNION ALL
  SELECT 5, 1,
    '--- Usage Summary --- (' || CAST((SELECT COUNT(*) FROM callers) AS VARCHAR) || ' callers)'
  WHERE (SELECT COUNT(*) FROM callers) > 0
  UNION ALL
  SELECT 6, ROW_NUMBER() OVER (ORDER BY Used_By_Type),
    '  ' || Used_By_Type || ': ' || CAST(Type_Count AS VARCHAR)
  FROM caller_type_counts

  UNION ALL

  -- Detailed caller list
  SELECT 8, 0, '' WHERE (SELECT COUNT(*) FROM callers) > 0
  UNION ALL
  SELECT 8, 1, '--- Callers ---'
  WHERE (SELECT COUNT(*) FROM callers) > 0
  UNION ALL
  SELECT 9, ROW_NUMBER() OVER (ORDER BY Used_By_Type, Used_By_Name),
    '  <- ' || Used_By_Type || ': ' || Used_By_Name
    || ' [' || Used_By_File || ']'
    || ' (' || CAST(Call_Count AS VARCHAR) || ' call'
    || CASE WHEN Call_Count > 1 THEN 's' ELSE '' END
    || COALESCE(', ' || Link_Subrole, '')
    || ')'
  FROM callers
) details
ORDER BY sort_key, sub_key;
