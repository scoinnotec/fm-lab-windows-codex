-- Best Practice Check: "Gehe zu Layout" gefolgt von "Suchenmodus aktivieren"
-- zur Identifikation von Scripts, die den empfohlenen Ablauf nicht einhalten
-- Ziel: Reihenfolge umkehren in "Enter Find Mode" gefolgt von "Go to Layout" (bessere Performance!)
--
-- Diese Query identifiziert alle Scripts, in denen die Schritte
-- "Go to Layout" (Step_ID 6) direkt gefolgt von "Enter Find Mode" (Step_ID 22) auftreten.
--
-- Verwendung:
--   duckdb db/fm_catalog.duckdb < sql/find_bestpractice_enterfindmode.sql

WITH StepSequence AS (
  SELECT
    s.Script_UUID,
    sc.Script_Name,
    s.Step_Index,
    s.Step_ID,
    s.Step_Name,
    LEAD(s.Step_ID) OVER (PARTITION BY s.Script_UUID ORDER BY s.Step_Index) AS Next_Step_ID,
    LEAD(s.Step_Name) OVER (PARTITION BY s.Script_UUID ORDER BY s.Step_Index) AS Next_Step_Name
  FROM StepsForScripts s
  JOIN ScriptCatalog sc ON s.Script_UUID = sc.Script_UUID
)
SELECT
  Script_Name,
  Step_Index,
  Step_Name,
  Next_Step_Name
FROM StepSequence
WHERE Step_ID = '6'
  AND Next_Step_ID = '22'
ORDER BY Script_Name, Step_Index;
