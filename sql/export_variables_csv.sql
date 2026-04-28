/*
-- Export aller Variablen als CSV
*/

COPY (
    WITH all_variables AS (
        -- 1. Direkt gesetzte Variablen (z.B. "Variable setzen")
        SELECT DISTINCT
            Variable_Name as Variable,
            'Set Variable' as Source_Type,
            Script_Name,
            Script_ID,
            Step_Name,
            Step_Index
        FROM StepsForScripts
        WHERE Variable_Name IS NOT NULL

        UNION ALL

        -- 2. Variablen aus Berechnungen extrahieren
        SELECT DISTINCT
            regexp_extract(Calculation_Text, '\$\$?[a-zA-Z0-9_]+', 0) as Variable,
            'Used in Calculation' as Source_Type,
            Script_Name,
            Script_ID,
            Step_Name,
            Step_Index
        FROM StepsForScripts
        WHERE Calculation_Text IS NOT NULL
            AND regexp_matches(Calculation_Text, '\$\$?[a-zA-Z0-9_]+')
    ),
    variable_occurrences AS (
        SELECT
            Variable,
            Source_Type,
            Script_Name,
            Script_ID,
            Step_Name,
            Step_Index
        FROM all_variables
        WHERE Variable IS NOT NULL
    )
    SELECT
        Variable,
        CASE
            WHEN Variable LIKE '$$%' THEN 'Global'
            WHEN Variable LIKE '$%' THEN 'Local'
            ELSE 'Unknown'
        END as Variable_Type,
        COUNT(*) as Usage_Count,
        COUNT(DISTINCT Script_ID) as Used_In_Scripts,
        string_agg(DISTINCT Script_Name, ', ' ORDER BY Script_Name) as Script_List
    FROM variable_occurrences
    GROUP BY Variable
    ORDER BY
        Variable_Type DESC,
        Usage_Count DESC,
        Variable
) TO 'output/variables_summary.csv' (HEADER, DELIMITER ',');
