-- Object Statistics Report
-- Lists all object types in the FileMaker solution with their counts
--
-- This template provides an overview of all objects in the selected FileMaker file.
--
-- Usage:
--   duckdb db/fm_catalog.duckdb < sql/report_object_statistics.sql
--
-- To change the FileMaker file, modify the SET VARIABLE file_name line below.
--
-- Current File: Artikel

.mode line
.header on

SET VARIABLE file_name = 'Artikel';  -- << Change this value to analyze different files

-- Display File Information Header
SELECT
    '========================================' as '',
    'Object Statistics Report' as '',
    '========================================' as '',
    'FileMaker File: ' || Filename as '',
    'FileMaker Version: ' || FileMaker_Version as '',
    'DDR Info Available: ' || Has_DDR_INFO as '',
    '========================================' as ''
FROM XMLMetadata
WHERE File_Name = getvariable('file_name');

.mode table
.header on

-- Object Statistics by Category
SELECT
    Object_Type,
    Object_Count,
    CASE
        WHEN Object_Type IN ('Base Tables', 'Table Occurrences', 'Relationships') THEN '1. Database'
        WHEN Object_Type IN ('Fields', 'Custom Functions', 'Calculations') THEN '2. Data Logic'
        WHEN Object_Type IN ('Scripts', 'Script Steps') THEN '3. Scripts'
        WHEN Object_Type IN ('Layouts', 'Layout Parts', 'Layout Objects') THEN '4. User Interface'
        WHEN Object_Type IN ('Value Lists', 'Accounts', 'Privilege Sets', 'Extended Privileges') THEN '5. Configuration'
        WHEN Object_Type IN ('External Data Sources', 'Custom Menus', 'Themes') THEN '6. Resources'
        ELSE '7. Other'
    END AS Category
FROM (
    -- Base Tables
    SELECT 'Base Tables' AS Object_Type, COUNT(*) AS Object_Count
    FROM BaseTableCatalog
    WHERE File_Name = getvariable('file_name')

    UNION ALL

    -- Table Occurrences
    SELECT 'Table Occurrences' AS Object_Type, COUNT(*) AS Object_Count
    FROM TableOccurrenceCatalog
    WHERE File_Name = getvariable('file_name')

    UNION ALL

    -- Relationships
    SELECT 'Relationships' AS Object_Type, COUNT(*) AS Object_Count
    FROM RelationshipCatalog
    WHERE File_Name = getvariable('file_name')

    UNION ALL

    -- Fields
    SELECT 'Fields' AS Object_Type, COUNT(*) AS Object_Count
    FROM FieldsForTables
    WHERE File_Name = getvariable('file_name')

    UNION ALL

    -- Scripts (only executable scripts, no folders/separators)
    SELECT 'Scripts' AS Object_Type, COUNT(*) AS Object_Count
    FROM ScriptCatalog
    WHERE File_Name = getvariable('file_name')
      AND (Folder_Type IS NULL OR Folder_Type = 'False')
      AND NOT Is_Separator

    UNION ALL

    -- Script Steps
    SELECT 'Script Steps' AS Object_Type, COUNT(*) AS Object_Count
    FROM StepsForScripts
    WHERE File_Name = getvariable('file_name')

    UNION ALL

    -- Custom Functions
    SELECT 'Custom Functions' AS Object_Type, COUNT(*) AS Object_Count
    FROM CustomFunctionsCatalog
    WHERE File_Name = getvariable('file_name')

    UNION ALL

    -- Layouts
    SELECT 'Layouts' AS Object_Type, COUNT(*) AS Object_Count
    FROM Layouts
    WHERE File_Name = getvariable('file_name')

    UNION ALL

    -- Layout Parts
    SELECT 'Layout Parts' AS Object_Type, COUNT(*) AS Object_Count
    FROM LayoutParts
    WHERE File_Name = getvariable('file_name')

    UNION ALL

    -- Layout Objects
    SELECT 'Layout Objects' AS Object_Type, COUNT(*) AS Object_Count
    FROM LayoutObjects
    WHERE File_Name = getvariable('file_name')

    UNION ALL

    -- Value Lists
    SELECT 'Value Lists' AS Object_Type, COUNT(*) AS Object_Count
    FROM ValueListCatalog
    WHERE File_Name = getvariable('file_name')

    UNION ALL

    -- External Data Sources
    SELECT 'External Data Sources' AS Object_Type, COUNT(*) AS Object_Count
    FROM ExternalDataSourceCatalog
    WHERE File_Name = getvariable('file_name')

    UNION ALL

    -- Accounts
    SELECT 'Accounts' AS Object_Type, COUNT(*) AS Object_Count
    FROM AccountsCatalog
    WHERE File_Name = getvariable('file_name')

    UNION ALL

    -- Privilege Sets
    SELECT 'Privilege Sets' AS Object_Type, COUNT(*) AS Object_Count
    FROM PrivilegeSetsCatalog
    WHERE File_Name = getvariable('file_name')

    UNION ALL

    -- Extended Privileges (if table exists and has data)
    SELECT 'Extended Privileges' AS Object_Type, COUNT(*) AS Object_Count
    FROM ExtendedPrivilegesCatalog
    WHERE File_Name = getvariable('file_name')

    UNION ALL

    -- Custom Menus (if table exists and has data)
    SELECT 'Custom Menus' AS Object_Type, COUNT(*) AS Object_Count
    FROM CustomMenuCatalog
    WHERE File_Name = getvariable('file_name')

    UNION ALL

    -- Themes (if table exists and has data)
    SELECT 'Themes' AS Object_Type, COUNT(*) AS Object_Count
    FROM ThemeCatalog
    WHERE File_Name = getvariable('file_name')
)
ORDER BY Category, Object_Type;
