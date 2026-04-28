/*
-- DuckDB SQL Query: Vereinfachte Liste aller verwendeten Variablen
--
-- Zeigt nur:
-- - Variablen-Name
-- - Typ (Global/Local)
-- - Anzahl der Vorkommen
--
-- Version 1.0
-- Date: 2026-01-12
*/

-- Alle Variablen sammeln
WITH all_variables AS (
    -- 1. Direkt gesetzte Variablen (z.B. "Variable setzen")
    SELECT DISTINCT
        Variable_Name as Variable
    FROM StepsForScripts
    WHERE Variable_Name IS NOT NULL

    UNION ALL

    -- 2. Variablen aus Berechnungen extrahieren
    -- FileMaker Variablen beginnen mit $ (lokal) oder $$ (global)
    SELECT DISTINCT
        regexp_extract(Calculation_Text, '\$\$?[a-zA-Z0-9_]+', 0) as Variable
    FROM StepsForScripts
    WHERE Calculation_Text IS NOT NULL
        AND regexp_matches(Calculation_Text, '\$\$?[a-zA-Z0-9_]+')
)
-- Distinct Liste mit Typ und Anzahl
SELECT
    Variable,
    -- Typ erkennen: $$ = global, $ = lokal
    CASE
        WHEN Variable LIKE '$$%' THEN 'Global'
        WHEN Variable LIKE '$%' THEN 'Local'
        ELSE 'Unknown'
    END as Variable_Type,
    COUNT(*) as Usage_Count
FROM all_variables
WHERE Variable IS NOT NULL
GROUP BY Variable
ORDER BY
    Variable_Type DESC,  -- Erst Global, dann Local
    Usage_Count DESC,    -- Häufigste zuerst
    Variable;
