-- ============================================
-- create_credential_analysis.sql
-- ============================================
-- Precomputed credential and user-data findings for the FileMaker browser.
--
-- Purpose:
-- Surface places where credentials, account names, SMTP login data, API/cURL
-- authentication options, external data sources, or suspicious password/token
-- keywords appear in the DDR import. FileMaker encrypted account passwords are
-- not decrypted; the DDR only exposes the encrypted value.

SET threads=4;
SET preserve_insertion_order=false;

DROP TABLE IF EXISTS CredentialFindings;

CREATE TABLE CredentialFindings AS
WITH
smtp_tags(Tag_Name, Credential_Type, Field_Name, Risk_Level, Is_Secret, Sort_Order) AS (
  VALUES
    ('Name', 'SMTP', 'Absendername', 'info', FALSE, 10),
    ('Email', 'SMTP', 'Absender-E-Mail', 'medium', FALSE, 20),
    ('ReplyTo', 'SMTP', 'Antwortadresse', 'medium', FALSE, 30),
    ('Server', 'SMTP', 'Server', 'medium', FALSE, 40),
    ('Port', 'SMTP', 'Port', 'info', FALSE, 50),
    ('UserName', 'SMTP', 'Benutzername', 'high', FALSE, 60),
    ('Password', 'SMTP', 'Passwort', 'high', TRUE, 70)
),
smtp_blocks AS (
  SELECT
    s.Script_UUID,
    s.Script_Name,
    s.Step_UUID,
    s.Step_Index + 1 AS Step_Number,
    s.Step_Name,
    s.File_Name,
    t.Credential_Type,
    t.Field_Name,
    t.Risk_Level,
    t.Is_Secret,
    t.Sort_Order,
    regexp_extract(
      s.Parameters_XML,
      '<' || t.Tag_Name || '>[[:space:][:print:]]*</' || t.Tag_Name || '>',
      0
    ) AS Field_XML
  FROM StepsForScripts s
  CROSS JOIN smtp_tags t
  WHERE s.Step_Name = 'Send Mail'
    AND COALESCE(s.Parameters_XML, '') ILIKE '%<SMTP>%'
),
smtp_values AS (
  SELECT
    md5('smtp|' || Step_UUID || '|' || File_Name || '|' || Field_Name) AS Finding_ID,
    'SMTP' AS Source_Category,
    Credential_Type,
    Field_Name,
    NULLIF(
      trim(
        replace(
          replace(
            replace(split_part(split_part(Field_XML, '<![CDATA[', 2), ']]>', 1), chr(127), chr(10)),
            '&quot;',
            '"'
          ),
          '&amp;',
          '&'
        )
      ),
      ''
    ) AS Value_Text,
    CASE
      WHEN Field_XML = '' THEN 'missing'
      WHEN regexp_matches(split_part(split_part(Field_XML, '<![CDATA[', 2), ']]>', 1), '^[[:space:]]*[$]') THEN 'variable'
      WHEN contains(split_part(split_part(Field_XML, '<![CDATA[', 2), ']]>', 1), '::') THEN 'field_reference'
      WHEN regexp_matches(split_part(split_part(Field_XML, '<![CDATA[', 2), ']]>', 1), '^[[:space:]]*"') THEN 'literal'
      ELSE 'calculation'
    END AS Value_Kind,
    Risk_Level,
    Is_Secret,
    'Script' AS Source_Type,
    Script_UUID AS Source_UUID,
    Script_Name AS Source_Name,
    File_Name AS Source_File,
    Step_UUID,
    Step_Number,
    Step_Name,
    Script_Name || ' [Schritt ' || CAST(Step_Number AS VARCHAR) || '] ' || Step_Name AS Source_Location,
    left(regexp_replace(Field_XML, '[[:space:]]+', ' ', 'g'), 800) AS Evidence_Text,
    'high' AS Confidence,
    Sort_Order
  FROM smtp_blocks
  WHERE Field_XML <> ''
),
smtp_auth_values AS (
  SELECT
    md5('smtp-auth|' || s.Step_UUID || '|' || s.File_Name) AS Finding_ID,
    'SMTP' AS Source_Category,
    'SMTP' AS Credential_Type,
    'Authentifizierung' AS Field_Name,
    NULLIF(regexp_extract(s.Parameters_XML, '<Authentication name="([^"]*)"', 1), '') AS Value_Text,
    'setting' AS Value_Kind,
    CASE
      WHEN regexp_extract(s.Parameters_XML, '<Authentication name="([^"]*)"', 1) ILIKE '%password%' THEN 'high'
      ELSE 'medium'
    END AS Risk_Level,
    FALSE AS Is_Secret,
    'Script' AS Source_Type,
    s.Script_UUID AS Source_UUID,
    s.Script_Name AS Source_Name,
    s.File_Name AS Source_File,
    s.Step_UUID,
    s.Step_Index + 1 AS Step_Number,
    s.Step_Name,
    s.Script_Name || ' [Schritt ' || CAST(s.Step_Index + 1 AS VARCHAR) || '] ' || s.Step_Name AS Source_Location,
    left(regexp_replace(regexp_extract(s.Parameters_XML, '<Authentication[^>]*>', 0), '[[:space:]]+', ' ', 'g'), 800) AS Evidence_Text,
    'high' AS Confidence,
    80 AS Sort_Order
  FROM StepsForScripts s
  WHERE s.Step_Name = 'Send Mail'
    AND COALESCE(s.Parameters_XML, '') ILIKE '%<SMTP>%'
    AND COALESCE(s.Parameters_XML, '') ILIKE '%<Authentication%'
),
api_blocks AS (
  SELECT
    s.Script_UUID,
    s.Script_Name,
    s.Step_UUID,
    s.Step_Index + 1 AS Step_Number,
    s.Step_Name,
    s.File_Name,
    regexp_extract(s.Parameters_XML, '<Parameter type="URL">[[:space:][:print:]]*</Parameter>', 0) AS Url_XML,
    regexp_extract(s.Parameters_XML, '<Parameter type="Calculation">[[:space:][:print:]]*</Parameter>', 0) AS Curl_XML,
    COALESCE(d.Step_Text, s.Parameters_XML, '') AS Step_Text
  FROM StepsForScripts s
  LEFT JOIN DDR_ScriptSteps d
    ON d.Step_UUID = s.Step_UUID
   AND d.File_Name = s.File_Name
  WHERE s.Step_Name = 'Insert from URL'
),
api_values AS (
  SELECT
    md5('api-url|' || Step_UUID || '|' || File_Name) AS Finding_ID,
    'API/cURL' AS Source_Category,
    'API/cURL' AS Credential_Type,
    'URL' AS Field_Name,
    NULLIF(
      trim(replace(split_part(split_part(Url_XML, '<![CDATA[', 2), ']]>', 1), chr(127), chr(10))),
      ''
    ) AS Value_Text,
    CASE
      WHEN regexp_matches(lower(split_part(split_part(Url_XML, '<![CDATA[', 2), ']]>', 1)), '(password|passwort|token|secret|apikey|api[_ -]?key|authorization|bearer)') THEN 'contains_secret_keyword'
      WHEN regexp_matches(split_part(split_part(Url_XML, '<![CDATA[', 2), ']]>', 1), '^[[:space:]]*[$]') THEN 'variable'
      WHEN contains(split_part(split_part(Url_XML, '<![CDATA[', 2), ']]>', 1), '::') THEN 'field_reference'
      WHEN regexp_matches(split_part(split_part(Url_XML, '<![CDATA[', 2), ']]>', 1), '^[[:space:]]*"') THEN 'literal'
      ELSE 'calculation'
    END AS Value_Kind,
    CASE
      WHEN regexp_matches(lower(Url_XML), '(password|passwort|token|secret|apikey|api[_ -]?key|authorization|bearer)') THEN 'high'
      ELSE 'medium'
    END AS Risk_Level,
    regexp_matches(lower(Url_XML), '(password|passwort|token|secret|apikey|api[_ -]?key|authorization|bearer)') AS Is_Secret,
    'Script' AS Source_Type,
    Script_UUID AS Source_UUID,
    Script_Name AS Source_Name,
    File_Name AS Source_File,
    Step_UUID,
    Step_Number,
    Step_Name,
    Script_Name || ' [Schritt ' || CAST(Step_Number AS VARCHAR) || '] ' || Step_Name AS Source_Location,
    left(regexp_replace(Url_XML, '[[:space:]]+', ' ', 'g'), 800) AS Evidence_Text,
    'high' AS Confidence,
    100 AS Sort_Order
  FROM api_blocks
  WHERE Url_XML <> ''

  UNION ALL

  SELECT
    md5('api-curl|' || Step_UUID || '|' || File_Name) AS Finding_ID,
    'API/cURL' AS Source_Category,
    'API/cURL' AS Credential_Type,
    'cURL-Optionen' AS Field_Name,
    NULLIF(
      trim(replace(split_part(split_part(Curl_XML, '<![CDATA[', 2), ']]>', 1), chr(127), chr(10))),
      ''
    ) AS Value_Text,
    CASE
      WHEN regexp_matches(lower(Curl_XML), '(authorization|bearer|basic|password|passwort|token|secret|apikey|api[_ -]?key|--user|-u[[:space:]])') THEN 'contains_secret_keyword'
      WHEN regexp_matches(split_part(split_part(Curl_XML, '<![CDATA[', 2), ']]>', 1), '^[[:space:]]*[$]') THEN 'variable'
      WHEN contains(split_part(split_part(Curl_XML, '<![CDATA[', 2), ']]>', 1), '::') THEN 'field_reference'
      ELSE 'calculation'
    END AS Value_Kind,
    CASE
      WHEN regexp_matches(lower(Curl_XML), '(authorization|bearer|basic|password|passwort|token|secret|apikey|api[_ -]?key|--user|-u[[:space:]])') THEN 'high'
      ELSE 'medium'
    END AS Risk_Level,
    regexp_matches(lower(Curl_XML), '(authorization|bearer|basic|password|passwort|token|secret|apikey|api[_ -]?key|--user|-u[[:space:]])') AS Is_Secret,
    'Script' AS Source_Type,
    Script_UUID AS Source_UUID,
    Script_Name AS Source_Name,
    File_Name AS Source_File,
    Step_UUID,
    Step_Number,
    Step_Name,
    Script_Name || ' [Schritt ' || CAST(Step_Number AS VARCHAR) || '] ' || Step_Name AS Source_Location,
    left(regexp_replace(Curl_XML, '[[:space:]]+', ' ', 'g'), 800) AS Evidence_Text,
    'high' AS Confidence,
    110 AS Sort_Order
  FROM api_blocks
  WHERE Curl_XML <> ''
    AND regexp_matches(lower(Curl_XML), '(authorization|bearer|basic|password|passwort|token|secret|apikey|api[_ -]?key|--user|-u[[:space:]])')

  UNION ALL

  SELECT
    md5('api-ssl|' || Step_UUID || '|' || File_Name) AS Finding_ID,
    'API/cURL' AS Source_Category,
    'API/cURL' AS Credential_Type,
    'SSL-Zertifikatsprüfung' AS Field_Name,
    'False' AS Value_Text,
    'setting' AS Value_Kind,
    'medium' AS Risk_Level,
    FALSE AS Is_Secret,
    'Script' AS Source_Type,
    Script_UUID AS Source_UUID,
    Script_Name AS Source_Name,
    File_Name AS Source_File,
    Step_UUID,
    Step_Number,
    Step_Name,
    Script_Name || ' [Schritt ' || CAST(Step_Number AS VARCHAR) || '] ' || Step_Name AS Source_Location,
    'Verify SSL Certificates = False' AS Evidence_Text,
    'high' AS Confidence,
    120 AS Sort_Order
  FROM api_blocks
  WHERE COALESCE(Step_Text, '') ILIKE '%Verify SSL Certificates%'
    AND COALESCE(Step_Text, '') ILIKE '%value="False"%'
),
account_values AS (
  SELECT
    md5('account-name|' || Account_UUID || '|' || File_Name) AS Finding_ID,
    'FileMaker Account' AS Source_Category,
    'Account' AS Credential_Type,
    'Account-Name' AS Field_Name,
    Account_Name AS Value_Text,
    'account_name' AS Value_Kind,
    CASE WHEN Is_Enabled THEN 'medium' ELSE 'info' END AS Risk_Level,
    FALSE AS Is_Secret,
    'Account' AS Source_Type,
    Account_UUID AS Source_UUID,
    COALESCE(Account_Name, 'Account') AS Source_Name,
    File_Name AS Source_File,
    NULL::VARCHAR AS Step_UUID,
    NULL::BIGINT AS Step_Number,
    NULL::VARCHAR AS Step_Name,
    COALESCE(Account_Name, 'Account') || ' / ' || COALESCE(PrivilegeSet_Name, 'ohne Rechtesatz') AS Source_Location,
    concat_ws(' | ',
      'Typ: ' || COALESCE(Account_Type, ''),
      CASE WHEN Is_Enabled THEN 'aktiv' ELSE 'deaktiviert' END,
      'Rechtesatz: ' || COALESCE(PrivilegeSet_Name, '')
    ) AS Evidence_Text,
    'high' AS Confidence,
    200 AS Sort_Order
  FROM AccountsCatalog
  WHERE COALESCE(Account_Name, '') <> ''

  UNION ALL

  SELECT
    md5('account-password|' || Account_UUID || '|' || File_Name) AS Finding_ID,
    'FileMaker Account' AS Source_Category,
    'Account' AS Credential_Type,
    'PasswordEncrypted' AS Field_Name,
    Password_Encrypted AS Value_Text,
    'encrypted_password' AS Value_Kind,
    'high' AS Risk_Level,
    TRUE AS Is_Secret,
    'Account' AS Source_Type,
    Account_UUID AS Source_UUID,
    COALESCE(Account_Name, 'Account') AS Source_Name,
    File_Name AS Source_File,
    NULL::VARCHAR AS Step_UUID,
    NULL::BIGINT AS Step_Number,
    NULL::VARCHAR AS Step_Name,
    COALESCE(Account_Name, 'Account') || ' / verschluesseltes Passwort' AS Source_Location,
    'DDR enthaelt nur PasswordEncrypted; Klartext ist nicht ableitbar.' AS Evidence_Text,
    'high' AS Confidence,
    210 AS Sort_Order
  FROM AccountsCatalog
  WHERE COALESCE(Password_Encrypted, '') <> ''
),
external_source_values AS (
  SELECT
    md5('external-ds|' || DS_UUID || '|' || File_Name) AS Finding_ID,
    'External Data Source' AS Source_Category,
    'Datenquelle' AS Credential_Type,
    CASE WHEN DS_Type = 'ODBC' THEN 'ODBC-Datenquelle' ELSE 'Dateipfad' END AS Field_Name,
    COALESCE(Path, DS_Name) AS Value_Text,
    CASE WHEN DS_Type = 'ODBC' THEN 'odbc_source' ELSE 'external_path' END AS Value_Kind,
    'medium' AS Risk_Level,
    FALSE AS Is_Secret,
    'ExternalDataSource' AS Source_Type,
    DS_UUID AS Source_UUID,
    DS_Name AS Source_Name,
    File_Name AS Source_File,
    NULL::VARCHAR AS Step_UUID,
    NULL::BIGINT AS Step_Number,
    NULL::VARCHAR AS Step_Name,
    DS_Name || ' / ' || COALESCE(DS_Type, 'Datenquelle') AS Source_Location,
    concat_ws(' | ', 'Typ: ' || COALESCE(DS_Type, ''), 'Pfad: ' || COALESCE(Path, '')) AS Evidence_Text,
    'medium' AS Confidence,
    300 AS Sort_Order
  FROM ExternalDataSourceCatalog
  WHERE COALESCE(DS_Name, '') <> ''
),
keyword_hits AS (
  SELECT
    md5('keyword|' || s.Step_UUID || '|' || s.File_Name) AS Finding_ID,
    'Script-Hinweis' AS Source_Category,
    'Keyword' AS Credential_Type,
    CASE
      WHEN regexp_matches(lower(concat_ws(' ', s.Variable_Name, s.Calculation_Text, s.Parameters_XML, d.Step_Text)), '(password|passwort)') THEN 'Passwort-Hinweis'
      WHEN regexp_matches(lower(concat_ws(' ', s.Variable_Name, s.Calculation_Text, s.Parameters_XML, d.Step_Text)), '(token|secret|api[_ -]?key|apikey)') THEN 'Token/API-Key-Hinweis'
      WHEN regexp_matches(lower(concat_ws(' ', s.Variable_Name, s.Calculation_Text, s.Parameters_XML, d.Step_Text)), '(authorization|bearer|basic|auth)') THEN 'Auth-Hinweis'
      ELSE 'Zugangsdaten-Hinweis'
    END AS Field_Name,
    COALESCE(s.Variable_Name, '') AS Value_Text,
    CASE WHEN COALESCE(s.Variable_Name, '') <> '' THEN 'variable' ELSE 'script_text' END AS Value_Kind,
    'high' AS Risk_Level,
    TRUE AS Is_Secret,
    'Script' AS Source_Type,
    s.Script_UUID AS Source_UUID,
    s.Script_Name AS Source_Name,
    s.File_Name AS Source_File,
    s.Step_UUID,
    s.Step_Index + 1 AS Step_Number,
    s.Step_Name,
    s.Script_Name || ' [Schritt ' || CAST(s.Step_Index + 1 AS VARCHAR) || '] ' || s.Step_Name AS Source_Location,
    left(
      regexp_replace(
        replace(concat_ws(' ', s.Variable_Name, s.Calculation_Text, s.Parameters_XML, d.Step_Text), chr(127), ' '),
        '[[:space:]]+',
        ' ',
        'g'
      ),
      1000
    ) AS Evidence_Text,
    'medium' AS Confidence,
    400 AS Sort_Order
  FROM StepsForScripts s
  LEFT JOIN DDR_ScriptSteps d
    ON d.Step_UUID = s.Step_UUID
   AND d.File_Name = s.File_Name
  WHERE s.Step_Name NOT IN ('Send Mail', 'Insert from URL')
    AND regexp_matches(
      lower(concat_ws(' ', s.Variable_Name, s.Calculation_Text, s.Parameters_XML, d.Step_Text)),
      '(password|passwort|token|secret|api[_ -]?key|apikey|authorization|bearer|basic[[:space:]]|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|smtp[_ -]?pass|auth)'
    )
)
SELECT *
FROM (
  SELECT * FROM smtp_values
  UNION ALL
  SELECT * FROM smtp_auth_values
  UNION ALL
  SELECT * FROM api_values
  UNION ALL
  SELECT * FROM account_values
  UNION ALL
  SELECT * FROM external_source_values
  UNION ALL
  SELECT * FROM keyword_hits
) findings
WHERE Finding_ID IS NOT NULL;
