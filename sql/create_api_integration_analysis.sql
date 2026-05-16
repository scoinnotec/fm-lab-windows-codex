-- ============================================
-- create_api_integration_analysis.sql
-- ============================================
-- Precomputed API and external integration findings for the FileMaker browser.
--
-- Purpose:
-- Group URL/cURL script steps and external data sources into recognizable
-- integration families such as DeepL, GraphHopper, Microsoft Graph or ODBC.
-- This builds on CredentialFindings, but focuses on "which services are
-- connected" instead of only showing credential/security hints.

SET threads=4;
SET preserve_insertion_order=false;

DROP TABLE IF EXISTS ApiIntegrationSummary;
DROP TABLE IF EXISTS ApiIntegrationFindings;

CREATE TABLE ApiIntegrationFindings AS
WITH
credential_api_rows AS (
  SELECT
    Finding_ID,
    'API' AS Integration_Type,
    Source_Category,
    Source_Type,
    Source_UUID,
    Source_Name,
    Source_File,
    Step_UUID,
    Step_Number,
    Step_Name,
    Field_Name,
    Value_Text AS Endpoint_Text,
    Value_Kind,
    Risk_Level,
    Is_Secret,
    Source_Location,
    Evidence_Text,
    Confidence,
    Sort_Order,
    1::BIGINT AS Usage_Count
  FROM CredentialFindings
  WHERE Source_Category = 'API/cURL'
),
browser_url_steps AS (
  SELECT
    md5('browser-url|' || s.Step_UUID || '|' || s.File_Name) AS Finding_ID,
    'API' AS Integration_Type,
    CASE
      WHEN s.Step_Name = 'Open URL' THEN 'Open URL'
      ELSE 'Web Viewer'
    END AS Source_Category,
    'Script' AS Source_Type,
    s.Script_UUID AS Source_UUID,
    s.Script_Name AS Source_Name,
    s.File_Name AS Source_File,
    s.Step_UUID,
    s.Step_Index + 1 AS Step_Number,
    s.Step_Name,
    CASE
      WHEN s.Step_Name = 'Open URL' THEN 'URL'
      ELSE 'Web Viewer URL'
    END AS Field_Name,
    NULLIF(
      trim(
        replace(
          replace(
            replace(split_part(split_part(regexp_extract(s.Parameters_XML, '<Parameter type="URL">[[:space:][:print:]]*</Parameter>', 0), '<![CDATA[', 2), ']]>', 1), chr(127), chr(10)),
            '&quot;',
            '"'
          ),
          '&amp;',
          '&'
        )
      ),
      ''
    ) AS Endpoint_Text,
    CASE
      WHEN regexp_matches(split_part(split_part(regexp_extract(s.Parameters_XML, '<Parameter type="URL">[[:space:][:print:]]*</Parameter>', 0), '<![CDATA[', 2), ']]>', 1), '^[[:space:]]*[$]') THEN 'variable'
      WHEN contains(split_part(split_part(regexp_extract(s.Parameters_XML, '<Parameter type="URL">[[:space:][:print:]]*</Parameter>', 0), '<![CDATA[', 2), ']]>', 1), '::') THEN 'field_reference'
      WHEN regexp_matches(split_part(split_part(regexp_extract(s.Parameters_XML, '<Parameter type="URL">[[:space:][:print:]]*</Parameter>', 0), '<![CDATA[', 2), ']]>', 1), '^[[:space:]]*"') THEN 'literal'
      ELSE 'calculation'
    END AS Value_Kind,
    CASE
      WHEN regexp_matches(lower(s.Parameters_XML), '(password|passwort|token|secret|apikey|api[_ -]?key|authorization|bearer)') THEN 'high'
      ELSE 'info'
    END AS Risk_Level,
    regexp_matches(lower(s.Parameters_XML), '(password|passwort|token|secret|apikey|api[_ -]?key|authorization|bearer)') AS Is_Secret,
    s.Script_Name || ' [Schritt ' || CAST(s.Step_Index + 1 AS VARCHAR) || '] ' || s.Step_Name AS Source_Location,
    left(regexp_replace(s.Parameters_XML, '[[:space:]]+', ' ', 'g'), 1000) AS Evidence_Text,
    'medium' AS Confidence,
    200 AS Sort_Order,
    1::BIGINT AS Usage_Count
  FROM StepsForScripts s
  WHERE s.Step_Name IN ('Open URL', 'Set Web Viewer')
    AND COALESCE(s.Parameters_XML, '') ILIKE '%<Parameter type="URL"%'
),
external_sources AS (
  SELECT
    md5('external-integration|' || e.DS_UUID || '|' || e.File_Name) AS Finding_ID,
    'External Database' AS Integration_Type,
    'External Data Source' AS Source_Category,
    'ExternalDataSource' AS Source_Type,
    e.DS_UUID AS Source_UUID,
    e.DS_Name AS Source_Name,
    e.File_Name AS Source_File,
    NULL::VARCHAR AS Step_UUID,
    NULL::BIGINT AS Step_Number,
    NULL::VARCHAR AS Step_Name,
    CASE
      WHEN e.DS_Type = 'ODBC' THEN 'ODBC-Datenquelle'
      ELSE 'FileMaker-Datenquelle'
    END AS Field_Name,
    COALESCE(e.Path, e.DS_Name) AS Endpoint_Text,
    CASE
      WHEN e.DS_Type = 'ODBC' THEN 'odbc_source'
      ELSE 'external_path'
    END AS Value_Kind,
    'medium' AS Risk_Level,
    FALSE AS Is_Secret,
    e.DS_Name || ' / ' || COALESCE(e.DS_Type, 'Datenquelle') AS Source_Location,
    concat_ws(' | ',
      'Typ: ' || COALESCE(e.DS_Type, ''),
      'Pfad: ' || COALESCE(e.Path, ''),
      'TOs: ' || CAST(COUNT(t.TO_UUID) AS VARCHAR)
    ) AS Evidence_Text,
    'high' AS Confidence,
    300 AS Sort_Order,
    COUNT(t.TO_UUID)::BIGINT AS Usage_Count
  FROM ExternalDataSourceCatalog e
  LEFT JOIN TableOccurrenceCatalog t
    ON t.DS_UUID = e.DS_UUID
   AND t.File_Name = e.File_Name
  WHERE COALESCE(e.DS_Name, '') <> ''
  GROUP BY
    e.DS_UUID,
    e.File_Name,
    e.DS_Name,
    e.DS_Type,
    e.Path
),
raw_findings AS (
  SELECT * FROM credential_api_rows
  UNION ALL
  SELECT * FROM browser_url_steps
  UNION ALL
  SELECT * FROM external_sources
),
classified AS (
  SELECT
    *,
    lower(concat_ws(' ', Source_Name, Field_Name, Endpoint_Text, Evidence_Text, Source_Category, Source_Location)) AS haystack
  FROM raw_findings
),
named AS (
  SELECT
    Finding_ID,
    Integration_Type,
    CASE
      WHEN Integration_Type = 'External Database' AND haystack LIKE '%odbc%' THEN 'ODBC: ' || COALESCE(Source_Name, 'Datenquelle')
      WHEN Integration_Type = 'External Database' THEN 'FileMaker: ' || COALESCE(Source_Name, 'Datenquelle')
      WHEN haystack LIKE '%deepl%' THEN 'DeepL'
      WHEN haystack LIKE '%graphhopper%' THEN 'GraphHopper'
      WHEN haystack LIKE '%graph.microsoft%' OR haystack LIKE '%microsoft_graph%' OR haystack LIKE '%azure%' THEN 'Microsoft Graph'
      WHEN haystack LIKE '%powerautomate%' OR haystack LIKE '%power_automate%' OR haystack LIKE '%power automate%' THEN 'Microsoft Power Automate'
      WHEN haystack LIKE '%openai%' OR haystack LIKE '%open_ai%' OR haystack LIKE '%chatgpt%' OR haystack LIKE '%chat_gpt%' OR haystack LIKE '%chat gpt%' OR haystack LIKE '%global_gpt%' THEN 'OpenAI / ChatGPT'
      WHEN haystack LIKE '%reloadify%' THEN 'Reloadify'
      WHEN haystack LIKE '%talent_lms%' OR haystack LIKE '%talentlms%' THEN 'TalentLMS'
      WHEN haystack LIKE '%shlink%' THEN 'Shlink'
      WHEN haystack LIKE '%dpd%' THEN 'DPD'
      WHEN haystack LIKE '%kununu%' THEN 'Kununu'
      WHEN haystack LIKE '%mapservice%' OR haystack LIKE '%easymap%' OR haystack LIKE '%maps.apple%' OR haystack LIKE '%comgooglemaps%' OR haystack LIKE '%google_maps%' OR haystack LIKE '%google maps%' OR haystack LIKE '%google.com/maps%' OR haystack LIKE '%google.at/search%' THEN 'Maps / Geocoding'
      WHEN haystack LIKE '%msteams:%' OR haystack LIKE '%teams.microsoft.com%' OR haystack LIKE '%teamsnachricht%' THEN 'Microsoft Teams URL'
      WHEN haystack LIKE '%callto:%' OR haystack LIKE '%tel:%' OR haystack LIKE '%voicememos:%' OR haystack LIKE '%fmp:%' OR haystack LIKE '%file://%' THEN 'App/Protocol URL'
      WHEN haystack LIKE '%company register%' OR haystack LIKE '%business register%' OR haystack LIKE '%firmen.wko%' OR haystack LIKE '%firmenabc%' OR haystack LIKE '%websuche%' OR haystack LIKE '%recherche_web%' THEN 'Company / Web Research'
      WHEN haystack LIKE '%webhook%' THEN 'Webhooks'
      WHEN haystack LIKE '%middleware%' THEN 'Middleware'
      WHEN haystack LIKE '%download%' OR haystack LIKE '%filetransfer%' OR haystack LIKE '%file_transfer%' THEN 'Web / Downloads'
      WHEN haystack LIKE '%pdf_generator%' OR haystack LIKE '%pdf generator%' THEN 'PDF Generator'
      WHEN haystack LIKE '%barcode%' THEN 'Barcode / Product URL'
      WHEN haystack LIKE '%oauth%' OR haystack LIKE '%bearer%' THEN 'OAuth / Token API'
      ELSE 'Other URL/API'
    END AS Api_Family,
    CASE
      WHEN Integration_Type = 'External Database' THEN COALESCE(Source_Name, 'Datenquelle')
      WHEN haystack LIKE '%deepl%' THEN 'DeepL'
      WHEN haystack LIKE '%graphhopper%' THEN 'GraphHopper'
      WHEN haystack LIKE '%graph.microsoft%' OR haystack LIKE '%microsoft_graph%' OR haystack LIKE '%azure%' THEN 'Microsoft Graph'
      WHEN haystack LIKE '%powerautomate%' OR haystack LIKE '%power_automate%' OR haystack LIKE '%power automate%' THEN 'Microsoft Power Automate'
      WHEN haystack LIKE '%openai%' OR haystack LIKE '%open_ai%' OR haystack LIKE '%chatgpt%' OR haystack LIKE '%chat_gpt%' OR haystack LIKE '%chat gpt%' OR haystack LIKE '%global_gpt%' THEN 'OpenAI / ChatGPT'
      WHEN haystack LIKE '%reloadify%' THEN 'Reloadify'
      WHEN haystack LIKE '%talent_lms%' OR haystack LIKE '%talentlms%' THEN 'TalentLMS'
      WHEN haystack LIKE '%shlink%' THEN 'Shlink'
      WHEN haystack LIKE '%dpd%' THEN 'DPD'
      WHEN haystack LIKE '%kununu%' THEN 'Kununu'
      WHEN haystack LIKE '%mapservice%' OR haystack LIKE '%easymap%' OR haystack LIKE '%maps.apple%' OR haystack LIKE '%comgooglemaps%' OR haystack LIKE '%google_maps%' OR haystack LIKE '%google maps%' OR haystack LIKE '%google.com/maps%' OR haystack LIKE '%google.at/search%' THEN 'Maps / Geocoding'
      WHEN haystack LIKE '%msteams:%' OR haystack LIKE '%teams.microsoft.com%' OR haystack LIKE '%teamsnachricht%' THEN 'Microsoft Teams URL'
      WHEN haystack LIKE '%callto:%' OR haystack LIKE '%tel:%' OR haystack LIKE '%voicememos:%' OR haystack LIKE '%fmp:%' OR haystack LIKE '%file://%' THEN 'App/Protocol URL'
      WHEN haystack LIKE '%company register%' OR haystack LIKE '%business register%' OR haystack LIKE '%firmen.wko%' OR haystack LIKE '%firmenabc%' OR haystack LIKE '%websuche%' OR haystack LIKE '%recherche_web%' THEN 'Company / Web Research'
      WHEN haystack LIKE '%webhook%' THEN 'Webhooks'
      WHEN haystack LIKE '%middleware%' THEN 'Middleware'
      WHEN haystack LIKE '%download%' OR haystack LIKE '%filetransfer%' OR haystack LIKE '%file_transfer%' THEN 'Web / Downloads'
      WHEN haystack LIKE '%pdf_generator%' OR haystack LIKE '%pdf generator%' THEN 'PDF Generator'
      WHEN haystack LIKE '%barcode%' THEN 'Barcode / Product URL'
      WHEN haystack LIKE '%oauth%' OR haystack LIKE '%bearer%' THEN 'OAuth / Token API'
      ELSE 'Other URL/API'
    END AS Api_Name,
    Source_Category,
    Source_Type,
    Source_UUID,
    Source_Name,
    Source_File,
    Step_UUID,
    Step_Number,
    Step_Name,
    Field_Name,
    Endpoint_Text,
    CASE
      WHEN Is_Secret AND COALESCE(Endpoint_Text, '') <> '' THEN '[secret masked]'
      ELSE Endpoint_Text
    END AS Safe_Endpoint_Text,
    Value_Kind,
    Risk_Level,
    Is_Secret,
    Source_Location,
    Evidence_Text,
    Confidence,
    Sort_Order,
    Usage_Count
  FROM classified
)
SELECT *
FROM named
WHERE Finding_ID IS NOT NULL;

CREATE TABLE ApiIntegrationSummary AS
SELECT
  md5('api-summary|' || Integration_Type || '|' || Api_Family) AS Summary_ID,
  Integration_Type,
  Api_Family,
  MIN(Api_Name) AS Api_Name,
  COUNT(*) AS Finding_Count,
  COUNT(DISTINCT Source_UUID) AS Source_Count,
  COUNT(DISTINCT Step_UUID) AS Step_Count,
  SUM(CASE WHEN Is_Secret THEN 1 ELSE 0 END) AS Secret_Count,
  SUM(CASE WHEN Risk_Level = 'high' THEN 1 ELSE 0 END) AS High_Risk_Count,
  SUM(CASE WHEN Risk_Level = 'medium' THEN 1 ELSE 0 END) AS Medium_Risk_Count,
  SUM(CASE WHEN Integration_Type = 'External Database' THEN Usage_Count ELSE 0 END) AS External_TO_Count,
  string_agg(DISTINCT COALESCE(Source_Name, ''), ', ') AS Example_Sources,
  string_agg(DISTINCT COALESCE(Safe_Endpoint_Text, ''), ', ') AS Example_Endpoints,
  MIN(Source_File) AS Source_File,
  MIN(Sort_Order) AS Sort_Order
FROM ApiIntegrationFindings
GROUP BY
  Integration_Type,
  Api_Family;
