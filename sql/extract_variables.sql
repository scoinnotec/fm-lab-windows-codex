/*
-- DuckDB SQL Query: Alle verwendeten Variablen aus Scripts extrahieren
--
-- Extrahiert sowohl direkt gesetzte Variablen (Variable_Name)
-- als auch Variablen die in Berechnungen verwendet werden (aus Calculation_Text)
--
-- Version 1.0
-- Date: 2026-01-12
*/

-- Alle Variablen sammeln und deduplizieren
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
    -- FileMaker Variablen beginnen mit $ (lokal) oder $$ (global)
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
-- Alle Variablen mit ihren Fundstellen
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
-- Zusammenfassung: Jede Variable mit Anzahl und Scripts
SELECT
    Variable,
    -- Typ erkennen: $$ = global, $ = lokal
    CASE
        WHEN Variable LIKE '$$%' THEN 'Global'
        WHEN Variable LIKE '$%' THEN 'Local'
        ELSE 'Unknown'
    END as Variable_Type,
    COUNT(*) as Usage_Count,
    COUNT(DISTINCT Script_ID) as Used_In_Scripts,
    -- Liste der Scripts, in denen die Variable vorkommt
    string_agg(DISTINCT Script_Name, ', ' ORDER BY Script_Name) as Script_List
FROM variable_occurrences
GROUP BY Variable
ORDER BY
    Variable_Type DESC,  -- Erst Global, dann Local
    Usage_Count DESC,    -- Häufigste zuerst
    Variable;
