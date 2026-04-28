-- List all Scripts in Pretty Format
SELECT
    Script_ID,
    CASE
        WHEN Folder_Type = 'True' THEN '📁 ' || Script_Name
        WHEN Folder_Type = 'Marker' OR Is_Separator THEN '----------'
        ELSE '  ' || Script_Name
    END AS Script_Name
FROM ScriptCatalog
;