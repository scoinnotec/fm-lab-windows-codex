-- @template_type: object
-- @description: List all scripts in a FileMaker file
-- @params: file (optional)
-- @output_format: uuid, name, type, folder_type, separator, file
-- @author: Marcel
-- @version: 1.1
-- @tags: scripts, objects

SELECT
    sc.Script_UUID as uuid,
    sc.Script_Name as name,
    'Script' as type,
    sc.Folder_Type as folder_type,
    sc.Is_Separator as separator,
    sc.File_Name as file
FROM ScriptCatalog sc
WHERE (getvariable('file') IS NULL OR sc.File_Name = getvariable('file'))
  AND (sc.Folder_Type IS NULL OR sc.Folder_Type = 'False')
  AND sc.Is_Separator = FALSE
ORDER BY sc.Script_Name;
