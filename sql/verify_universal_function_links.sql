-- Akzeptanzkriterien-Verifikation für PRD prd_universal_function_links.md §11
-- Nach Re-Import via `convert-xml --batch` ausführen:
--   ~/.duckdb/cli/latest/duckdb db/fm_catalog.duckdb < sql/verify_universal_function_links.sql

.print '=== A) Chunk-Index in XML-Dokumentreihenfolge (PRD §11.1) ==='
.print 'Stichprobe _OnServer (sollte mit FunctionRef beginnen, nicht NoRef):'
SELECT d.Chunk_Index, d.Chunk_Type,
       regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) AS Token
FROM DDR_Calculations d
JOIN CustomFunctionsCatalog cf ON cf.DDR_Hash = d.Calc_Hash AND cf.File_Name = d.File_Name
WHERE cf.CF_Name = '_OnServer'
ORDER BY d.Chunk_Index
LIMIT 10;

.print ''
.print '=== B) ObjectCatalog Statistik (PRD §11.2, §11.3) ==='
SELECT Object_Type, COUNT(*) AS cnt
FROM ObjectCatalog
WHERE Object_Type IN ('BuiltinFunction','PluginFunction')
GROUP BY Object_Type;

.print ''
.print '=== B-Detail) Top BuiltinFunctions ==='
SELECT Object_Name, COUNT(*) OVER (PARTITION BY Object_Name) AS dup_count
FROM ObjectCatalog
WHERE Object_Type = 'BuiltinFunction'
ORDER BY Object_Name
LIMIT 20;

.print ''
.print '=== C) Beispiel-Query 1: Wer ruft Case auf? (PRD §11.4) ==='
SELECT oc_src.Object_Type AS caller_type,
       COUNT(*) AS calls
FROM ObjectCatalog oc_tgt
JOIN ObjectLinks ol ON ol.Target_UUID = oc_tgt.Object_UUID
JOIN ObjectCatalog oc_src ON oc_src.Object_UUID = ol.Source_UUID
WHERE oc_tgt.Object_Type = 'BuiltinFunction'
  AND oc_tgt.Object_Name = 'Case'
GROUP BY oc_src.Object_Type
ORDER BY calls DESC;

.print ''
.print '=== D) Beispiel-Query 2: Wo wird Get(ApplicationVersion) aufgerufen? (PRD §11.5) ==='
.print '(Hinweis: lokalisiert oft als Get(ProgrammVersion) im DDR)'
SELECT oc_src.Object_Type, oc_src.File_Name, COUNT(*) AS calls
FROM XMLCalcReferences xcr
JOIN ObjectCatalog oc_src ON oc_src.Object_UUID = xcr.Source_UUID
WHERE xcr.Ref_Type = 'function'
  AND xcr.Ref_Name = 'Get'
  AND xcr.Ref_SubName IN ('ApplicationVersion','ProgrammVersion')
GROUP BY oc_src.Object_Type, oc_src.File_Name
ORDER BY calls DESC
LIMIT 10;

.print ''
.print '=== E) Beispiel-Query 3: Wo wird MBS::XL.Book.AddFormat aufgerufen? (PRD §11.6) ==='
SELECT oc_src.Object_Type, oc_src.Object_Name, oc_src.File_Name, ol.Link_Subrole
FROM ObjectCatalog oc_tgt
JOIN ObjectLinks ol ON ol.Target_UUID = oc_tgt.Object_UUID
JOIN ObjectCatalog oc_src ON oc_src.Object_UUID = ol.Source_UUID
WHERE oc_tgt.Object_Type = 'PluginFunction'
  AND oc_tgt.Object_Name = 'MBS::XL.Book.AddFormat'
LIMIT 10;

.print ''
.print '=== F) GetSubparameterMap Coverage ==='
SELECT
  COUNT(*) AS total_get_calls,
  COUNT(SubParameter) AS resolved,
  ROUND(100.0 * COUNT(SubParameter) / COUNT(*), 1) AS resolve_pct
FROM GetSubparameterMap;

.print ''
.print '=== G) Top 10 distinct Get Sub-Parameter ==='
SELECT SubParameter, COUNT(*) AS occurrences
FROM GetSubparameterMap
WHERE SubParameter IS NOT NULL
GROUP BY SubParameter
ORDER BY occurrences DESC
LIMIT 10;

.print ''
.print '=== H) PluginFunctionUsages Coverage (Calc_UUID gefüllt?) ==='
SELECT
  COUNT(*) AS total,
  COUNT(Calc_UUID) AS with_calc_uuid,
  COUNT(Plugin_Chunk_Index) AS with_chunk_index
FROM PluginFunctionUsages;

.print ''
.print '=== I) ObjectLinks: neue Rollen ==='
SELECT Link_Role, COUNT(*) AS cnt
FROM ObjectLinks
WHERE Link_Role IN ('calls_function','calls_pluginfunction')
GROUP BY Link_Role;
