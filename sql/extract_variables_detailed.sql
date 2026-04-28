/*
-- DuckDB SQL Query: Detaillierte Liste aller Variablen-Verwendungen
--
-- Zeigt jede einzelne Verwendung einer Variable mit Script und Kontext
--
-- Version 1.0
-- Date: 2026-01-12
*/

WITH all_variables AS (
    -- 1. Direkt gesetzte Variablen (z.B. "Variable setzen")
    SELECT
        Variable_Name as Variable,
        'Set Variable' as Source_Type,
        Script_ID,
        Script_Name,
        Step_Index,
        Step_Name,
        Calculation_Text as Context
    FROM StepsForScripts
    WHERE Variable_Name IS NOT NULL

    UNION ALL

    -- 2. Variablen aus Berechnungen extrahieren
    -- Alle Variablen in einem Calculation_Text finden
    SELECT
        unnest(regexp_extract_all(Calculation_Text, '\$\$?[a-zA-Z0-9_]+')) as Variable,
        'Used in Calculation' as Source_Type,
        Script_ID,
        Script_Name,
        Step_Index,
        Step_Name,
        Calculation_Text as Context
    FROM StepsForScripts
    WHERE Calculation_Text IS NOT NULL
        AND regexp_matches(Calculation_Text, '\$\$?[a-zA-Z0-9_]+')
)
SELECT
    Variable,
    -- Typ erkennen
    CASE
        WHEN Variable LIKE '$$%' THEN 'Global'
        WHEN Variable LIKE '$%' THEN 'Local'
        ELSE 'Unknown'
    END as Variable_Type,
    Source_Type,
    Script_Name,
    Step_Index,
    Step_Name,
    -- Kontext kürzen für bessere Lesbarkeit
    CASE
        WHEN length(Context) > 100 THEN left(Context, 97) || '...'
        ELSE Context
    END as Context_Preview
FROM all_variables
WHERE Variable IS NOT NULL
ORDER BY
    Variable,
    Script_Name,
    Step_Index;
