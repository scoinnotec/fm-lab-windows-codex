-- ============================================
-- create_localization_labels.sql
-- ============================================
-- UI and FileMaker terminology localization.
--
-- Purpose:
-- Keep user-facing labels in DuckDB so the REST API and web UI can show the
-- same FileMaker object names in German and English.
--
-- Main terminology sources:
-- - https://help.claris.com/en/pro-help/content/solutions.html
-- - https://help.claris.com/de/pro-help/content/solutions.html
-- - https://help.claris.com/en/pro-help/content/design-functions.html
-- - https://help.claris.com/de/pro-help/content/design-functions.html
-- - https://help.claris.com/en/pro-help/content/script-steps-reference.html
-- - https://help.claris.com/de/pro-help/content/script-steps-reference.html
-- - https://help.claris.com/en/pro-help/content/working-with-layout-objects.html
-- - https://help.claris.com/de/pro-help/content/working-with-layout-objects.html
-- - https://help.claris.com/en/pro-help/content/adding-tables.html
-- - https://help.claris.com/de/pro-help/content/adding-tables.html

DROP VIEW IF EXISTS AnalysisDashboardLocalized;
DROP VIEW IF EXISTS QualityFindingsLocalized;
DROP VIEW IF EXISTS LocalizationLabelsPivot;
DROP TABLE IF EXISTS LocalizationLabels;

CREATE TABLE LocalizationLabels AS
SELECT *
FROM (
  VALUES
    ('ui.tab.dashboard', 'ui', 'de', 'Dashboard', 'fm-lab UI', NULL, 10),
    ('ui.tab.dashboard', 'ui', 'en', 'Dashboard', 'fm-lab UI', NULL, 10),
    ('ui.tab.search', 'ui', 'de', 'Suche', 'fm-lab UI', NULL, 20),
    ('ui.tab.search', 'ui', 'en', 'Search', 'fm-lab UI', NULL, 20),
    ('ui.tab.hierarchy', 'ui', 'de', 'Hierarchie', 'fm-lab UI', NULL, 30),
    ('ui.tab.hierarchy', 'ui', 'en', 'Hierarchy', 'fm-lab UI', NULL, 30),
    ('ui.tab.script_content', 'ui', 'de', 'Script-Inhalte', 'fm-lab UI', NULL, 40),
    ('ui.tab.script_content', 'ui', 'en', 'Script content', 'fm-lab UI', NULL, 40),
    ('ui.tab.to_usage', 'ui', 'de', 'TO-Nutzung', 'fm-lab UI', NULL, 50),
    ('ui.tab.to_usage', 'ui', 'en', 'TO usage', 'fm-lab UI', NULL, 50),
    ('ui.tab.object_usage', 'ui', 'de', 'Objekt-Nutzung', 'fm-lab UI', NULL, 60),
    ('ui.tab.object_usage', 'ui', 'en', 'Object usage', 'fm-lab UI', NULL, 60),
    ('ui.tab.layout_quality', 'ui', 'de', 'Layout-Prüfung', 'fm-lab UI', NULL, 70),
    ('ui.tab.layout_quality', 'ui', 'en', 'Layout checks', 'fm-lab UI', NULL, 70),
    ('ui.tab.quality', 'ui', 'de', 'Prüfungen', 'fm-lab UI', NULL, 80),
    ('ui.tab.quality', 'ui', 'en', 'Checks', 'fm-lab UI', NULL, 80),
    ('ui.tab.api_integrations', 'ui', 'de', 'APIs', 'fm-lab UI', NULL, 90),
    ('ui.tab.api_integrations', 'ui', 'en', 'APIs', 'fm-lab UI', NULL, 90),
    ('ui.tab.server_logs', 'ui', 'de', 'Server-Logs', 'fm-lab UI', NULL, 100),
    ('ui.tab.server_logs', 'ui', 'en', 'Server logs', 'fm-lab UI', NULL, 100),
    ('ui.tab.ai_chat', 'ui', 'de', 'AI-Chat', 'fm-lab UI', NULL, 110),
    ('ui.tab.ai_chat', 'ui', 'en', 'AI chat', 'fm-lab UI', NULL, 110),
    ('ui.tab.credentials', 'ui', 'de', 'Zugangsdaten', 'fm-lab UI', NULL, 120),
    ('ui.tab.credentials', 'ui', 'en', 'Credentials', 'fm-lab UI', NULL, 120),

    ('section.Objekte', 'dashboard_section', 'de', 'Objekte', 'fm-lab UI', NULL, 100),
    ('section.Objekte', 'dashboard_section', 'en', 'Objects', 'fm-lab UI', NULL, 100),
    ('section.Qualität', 'dashboard_section', 'de', 'Qualität', 'fm-lab UI', NULL, 110),
    ('section.Qualität', 'dashboard_section', 'en', 'Quality', 'fm-lab UI', NULL, 110),
    ('section.Layout-Prüfung', 'dashboard_section', 'de', 'Layout-Prüfung', 'fm-lab UI', NULL, 120),
    ('section.Layout-Prüfung', 'dashboard_section', 'en', 'Layout checks', 'fm-lab UI', NULL, 120),
    ('section.Zugangsdaten', 'dashboard_section', 'de', 'Zugangsdaten', 'fm-lab UI', NULL, 130),
    ('section.Zugangsdaten', 'dashboard_section', 'en', 'Credentials', 'fm-lab UI', NULL, 130),
    ('section.Import', 'dashboard_section', 'de', 'Import', 'fm-lab UI', NULL, 140),
    ('section.Import', 'dashboard_section', 'en', 'Import', 'fm-lab UI', NULL, 140),

    ('object.ScriptStep', 'object_type', 'de', 'Scriptschritt', 'Claris FileMaker Pro Hilfe: Scriptschritte-Referenz', 'https://help.claris.com/de/pro-help/content/script-steps-reference.html', 200),
    ('object.ScriptStep', 'object_type', 'en', 'Script step', 'Claris FileMaker Pro Help: Script steps reference', 'https://help.claris.com/en/pro-help/content/script-steps-reference.html', 200),
    ('object.Script', 'object_type', 'de', 'Script', 'Claris FileMaker Pro Hilfe: Eigene Apps in FileMaker Pro', 'https://help.claris.com/de/pro-help/content/solutions.html', 210),
    ('object.Script', 'object_type', 'en', 'Script', 'Claris FileMaker Pro Help: About FileMaker Pro custom apps', 'https://help.claris.com/en/pro-help/content/solutions.html', 210),
    ('object.Field', 'object_type', 'de', 'Feld', 'Claris FileMaker Pro Hilfe: Eigene Apps in FileMaker Pro', 'https://help.claris.com/de/pro-help/content/solutions.html', 220),
    ('object.Field', 'object_type', 'en', 'Field', 'Claris FileMaker Pro Help: About FileMaker Pro custom apps', 'https://help.claris.com/en/pro-help/content/solutions.html', 220),
    ('object.Layout', 'object_type', 'de', 'Layout', 'Claris FileMaker Pro Hilfe: Eigene Apps in FileMaker Pro', 'https://help.claris.com/de/pro-help/content/solutions.html', 230),
    ('object.Layout', 'object_type', 'en', 'Layout', 'Claris FileMaker Pro Help: About FileMaker Pro custom apps', 'https://help.claris.com/en/pro-help/content/solutions.html', 230),
    ('object.Relationship', 'object_type', 'de', 'Beziehung', 'Claris FileMaker Pro Hilfe: Eigene Apps in FileMaker Pro', 'https://help.claris.com/de/pro-help/content/solutions.html', 240),
    ('object.Relationship', 'object_type', 'en', 'Relationship', 'Claris FileMaker Pro Help: About FileMaker Pro custom apps', 'https://help.claris.com/en/pro-help/content/solutions.html', 240),
    ('object.TableOccurrence', 'object_type', 'de', 'Tabellenauftreten', 'Claris FileMaker Pro Hilfe: Hinzufügen und Auswählen von Tabellenauftreten', 'https://help.claris.com/de/pro-help/content/adding-tables.html', 250),
    ('object.TableOccurrence', 'object_type', 'en', 'Table occurrence', 'Claris FileMaker Pro Help: Adding and selecting table occurrences', 'https://help.claris.com/en/pro-help/content/adding-tables.html', 250),
    ('object.BaseTable', 'object_type', 'de', 'Basistabelle', 'Claris FileMaker Pro Hilfe: Designfunktionen', 'https://help.claris.com/de/pro-help/content/design-functions.html', 260),
    ('object.BaseTable', 'object_type', 'en', 'Base table', 'Claris FileMaker Pro Help: Design functions', 'https://help.claris.com/en/pro-help/content/design-functions.html', 260),
    ('object.ValueList', 'object_type', 'de', 'Werteliste', 'Claris FileMaker Pro Hilfe: Designfunktionen', 'https://help.claris.com/de/pro-help/content/design-functions.html', 270),
    ('object.ValueList', 'object_type', 'en', 'Value list', 'Claris FileMaker Pro Help: Design functions', 'https://help.claris.com/en/pro-help/content/design-functions.html', 270),
    ('object.LayoutObject', 'object_type', 'de', 'Layoutobjekt', 'Claris FileMaker Pro Hilfe: Im Register Objekte mit Objekten arbeiten', 'https://help.claris.com/de/pro-help/content/working-with-layout-objects.html', 280),
    ('object.LayoutObject', 'object_type', 'en', 'Layout object', 'Claris FileMaker Pro Help: Using the Objects tab to work with objects', 'https://help.claris.com/en/pro-help/content/working-with-layout-objects.html', 280),
    ('object.LayoutPart', 'object_type', 'de', 'Layoutbereich', 'Claris FileMaker Pro Hilfe: Bearbeiten von Objekten, Layoutbereichen und Layouthintergrund', 'https://help.claris.com/de/pro-help/content/working-with-layout-objects.html', 290),
    ('object.LayoutPart', 'object_type', 'en', 'Layout part', 'Claris FileMaker Pro Help: Editing objects, layout parts, and the layout background', 'https://help.claris.com/en/pro-help/content/working-with-layout-objects.html', 290),
    ('object.CustomFunction', 'object_type', 'de', 'Eigene Funktion', 'Claris FileMaker Pro Hilfe: Funktionen-Referenz', 'https://help.claris.com/de/pro-help/content/functions-reference.html', 300),
    ('object.CustomFunction', 'object_type', 'en', 'Custom function', 'Claris FileMaker Pro Help: Functions reference', 'https://help.claris.com/en/pro-help/content/functions-reference.html', 300),
    ('object.Variable', 'object_type', 'de', 'Variable', 'Claris FileMaker Pro Hilfe: Scriptschritte-Referenz', 'https://help.claris.com/de/pro-help/content/script-steps-reference.html', 310),
    ('object.Variable', 'object_type', 'en', 'Variable', 'Claris FileMaker Pro Help: Script steps reference', 'https://help.claris.com/en/pro-help/content/script-steps-reference.html', 310),
    ('object.Folder', 'object_type', 'de', 'Ordner', 'fm-lab UI', NULL, 320),
    ('object.Folder', 'object_type', 'en', 'Folder', 'fm-lab UI', NULL, 320),
    ('object.ExternalDataSource', 'object_type', 'de', 'Externe Datenquelle', 'Claris FileMaker Pro Hilfe: Zugreifen auf externe Datenquellen', 'https://help.claris.com/de/pro-help/content/index.html', 330),
    ('object.ExternalDataSource', 'object_type', 'en', 'External data source', 'Claris FileMaker Pro Help: Accessing external data sources', 'https://help.claris.com/en/pro-help/content/index.html', 330),
    ('object.Account', 'object_type', 'de', 'Konto', 'Claris FileMaker Pro Hilfe: Verwalten der Sicherheit', 'https://help.claris.com/de/pro-help/content/index.html', 340),
    ('object.Account', 'object_type', 'en', 'Account', 'Claris FileMaker Pro Help: Managing security', 'https://help.claris.com/en/pro-help/content/index.html', 340),
    ('object.PrivilegeSet', 'object_type', 'de', 'Berechtigungsset', 'Claris FileMaker Pro Hilfe: Verwalten der Sicherheit', 'https://help.claris.com/de/pro-help/content/index.html', 350),
    ('object.PrivilegeSet', 'object_type', 'en', 'Privilege set', 'Claris FileMaker Pro Help: Managing security', 'https://help.claris.com/en/pro-help/content/index.html', 350),

    ('layout_object.Text', 'layout_object_type', 'de', 'Text', 'Claris FileMaker Pro Hilfe: Im Register Objekte mit Objekten arbeiten', 'https://help.claris.com/de/pro-help/content/working-with-layout-objects.html', 400),
    ('layout_object.Text', 'layout_object_type', 'en', 'Text', 'Claris FileMaker Pro Help: Using the Objects tab to work with objects', 'https://help.claris.com/en/pro-help/content/working-with-layout-objects.html', 400),
    ('layout_object.Button', 'layout_object_type', 'de', 'Taste', 'Claris FileMaker Pro Hilfe: Im Register Objekte mit Objekten arbeiten', 'https://help.claris.com/de/pro-help/content/working-with-layout-objects.html', 410),
    ('layout_object.Button', 'layout_object_type', 'en', 'Button', 'Claris FileMaker Pro Help: Using the Objects tab to work with objects', 'https://help.claris.com/en/pro-help/content/working-with-layout-objects.html', 410),
    ('layout_object.ButtonBarSegment', 'layout_object_type', 'de', 'Tastenleistensegment', 'Claris FileMaker Pro Hilfe: Im Register Objekte mit Objekten arbeiten', 'https://help.claris.com/de/pro-help/content/working-with-layout-objects.html', 420),
    ('layout_object.ButtonBarSegment', 'layout_object_type', 'en', 'Button bar segment', 'Claris FileMaker Pro Help: Using the Objects tab to work with objects', 'https://help.claris.com/en/pro-help/content/working-with-layout-objects.html', 420),
    ('layout_object.Popover', 'layout_object_type', 'de', 'Popover', 'Claris FileMaker Pro Hilfe: Im Register Objekte mit Objekten arbeiten', 'https://help.claris.com/de/pro-help/content/working-with-layout-objects.html', 430),
    ('layout_object.Popover', 'layout_object_type', 'en', 'Popover', 'Claris FileMaker Pro Help: Using the Objects tab to work with objects', 'https://help.claris.com/en/pro-help/content/working-with-layout-objects.html', 430),
    ('layout_object.TabPanel', 'layout_object_type', 'de', 'Registerbereich', 'Claris FileMaker Pro Hilfe: Im Register Objekte mit Objekten arbeiten', 'https://help.claris.com/de/pro-help/content/working-with-layout-objects.html', 440),
    ('layout_object.TabPanel', 'layout_object_type', 'en', 'Tab panel', 'Claris FileMaker Pro Help: Using the Objects tab to work with objects', 'https://help.claris.com/en/pro-help/content/working-with-layout-objects.html', 440),
    ('layout_object.Portal', 'layout_object_type', 'de', 'Ausschnitt', 'Claris FileMaker Pro Hilfe: Im Register Objekte mit Objekten arbeiten', 'https://help.claris.com/de/pro-help/content/working-with-layout-objects.html', 450),
    ('layout_object.Portal', 'layout_object_type', 'en', 'Portal', 'Claris FileMaker Pro Help: Using the Objects tab to work with objects', 'https://help.claris.com/en/pro-help/content/working-with-layout-objects.html', 450),

    ('area.Namenskonventionen', 'quality_area', 'de', 'Namenskonventionen', 'fm-lab analysis', NULL, 500),
    ('area.Namenskonventionen', 'quality_area', 'en', 'Naming conventions', 'fm-lab analysis', NULL, 500),
    ('area.Feld-Qualität', 'quality_area', 'de', 'Feld-Qualität', 'fm-lab analysis', NULL, 510),
    ('area.Feld-Qualität', 'quality_area', 'en', 'Field quality', 'fm-lab analysis', NULL, 510),
    ('area.Script-Risiken', 'quality_area', 'de', 'Script-Risiken', 'fm-lab analysis', NULL, 520),
    ('area.Script-Risiken', 'quality_area', 'en', 'Script risks', 'fm-lab analysis', NULL, 520),
    ('area.Erreichbarkeit', 'quality_area', 'de', 'Erreichbarkeit', 'fm-lab analysis', NULL, 530),
    ('area.Erreichbarkeit', 'quality_area', 'en', 'Reachability', 'fm-lab analysis', NULL, 530),
    ('area.Referenzfehler', 'quality_area', 'de', 'Referenzfehler', 'fm-lab analysis', NULL, 540),
    ('area.Referenzfehler', 'quality_area', 'en', 'Reference errors', 'fm-lab analysis', NULL, 540),
    ('area.Änderungen', 'quality_area', 'de', 'Änderungen', 'fm-lab analysis', NULL, 550),
    ('area.Änderungen', 'quality_area', 'en', 'Changes', 'fm-lab analysis', NULL, 550),

    ('layout_issue.Überlappungen', 'layout_issue', 'de', 'Überlappungen', 'fm-lab analysis', NULL, 600),
    ('layout_issue.Überlappungen', 'layout_issue', 'en', 'Overlaps', 'fm-lab analysis', NULL, 600),
    ('layout_issue.Außerhalb Layout', 'layout_issue', 'de', 'Außerhalb Layout', 'fm-lab analysis', NULL, 610),
    ('layout_issue.Außerhalb Layout', 'layout_issue', 'en', 'Outside layout', 'fm-lab analysis', NULL, 610),
    ('layout_issue.Leere Textobjekte', 'layout_issue', 'de', 'Leere Textobjekte', 'fm-lab analysis', NULL, 620),
    ('layout_issue.Leere Textobjekte', 'layout_issue', 'en', 'Empty text objects', 'fm-lab analysis', NULL, 620),
    ('layout_issue.Kopierte Objektnamen', 'layout_issue', 'de', 'Kopierte Objektnamen', 'fm-lab analysis', NULL, 630),
    ('layout_issue.Kopierte Objektnamen', 'layout_issue', 'en', 'Copied object names', 'fm-lab analysis', NULL, 630),
    ('layout_issue.Doppelte Objektnamen', 'layout_issue', 'de', 'Doppelte Objektnamen', 'fm-lab analysis', NULL, 640),
    ('layout_issue.Doppelte Objektnamen', 'layout_issue', 'en', 'Duplicate object names', 'fm-lab analysis', NULL, 640),
    ('layout_issue.Außerhalb Parent', 'layout_issue', 'de', 'Außerhalb Parent', 'fm-lab analysis', NULL, 650),
    ('layout_issue.Außerhalb Parent', 'layout_issue', 'en', 'Outside parent', 'fm-lab analysis', NULL, 650),
    ('layout_issue.Sehr kleine Objekte', 'layout_issue', 'de', 'Sehr kleine Objekte', 'fm-lab analysis', NULL, 660),
    ('layout_issue.Sehr kleine Objekte', 'layout_issue', 'en', 'Very small objects', 'fm-lab analysis', NULL, 660),
    ('layout_issue.Nullmaß', 'layout_issue', 'de', 'Nullmaß', 'fm-lab analysis', NULL, 670),
    ('layout_issue.Nullmaß', 'layout_issue', 'en', 'Zero size', 'fm-lab analysis', NULL, 670),

    ('credential.Script-Hinweis', 'credential_category', 'de', 'Script-Hinweis', 'fm-lab analysis', NULL, 700),
    ('credential.Script-Hinweis', 'credential_category', 'en', 'Script hint', 'fm-lab analysis', NULL, 700),
    ('credential.SMTP', 'credential_category', 'de', 'SMTP', 'Claris FileMaker Pro Hilfe: Scriptschritte-Referenz', 'https://help.claris.com/de/pro-help/content/script-steps-reference.html', 710),
    ('credential.SMTP', 'credential_category', 'en', 'SMTP', 'Claris FileMaker Pro Help: Script steps reference', 'https://help.claris.com/en/pro-help/content/script-steps-reference.html', 710),
    ('credential.FileMaker Account', 'credential_category', 'de', 'FileMaker-Konto', 'Claris FileMaker Pro Hilfe: Verwalten der Sicherheit', 'https://help.claris.com/de/pro-help/content/index.html', 720),
    ('credential.FileMaker Account', 'credential_category', 'en', 'FileMaker account', 'Claris FileMaker Pro Help: Managing security', 'https://help.claris.com/en/pro-help/content/index.html', 720),
    ('credential.API/cURL', 'credential_category', 'de', 'API/cURL', 'fm-lab analysis', NULL, 730),
    ('credential.API/cURL', 'credential_category', 'en', 'API/cURL', 'fm-lab analysis', NULL, 730),
    ('credential.External Data Source', 'credential_category', 'de', 'Externe Datenquelle', 'Claris FileMaker Pro Hilfe: Zugreifen auf externe Datenquellen', 'https://help.claris.com/de/pro-help/content/index.html', 740),
    ('credential.External Data Source', 'credential_category', 'en', 'External data source', 'Claris FileMaker Pro Help: Accessing external data sources', 'https://help.claris.com/en/pro-help/content/index.html', 740),

    ('import.Dateien', 'import_metric', 'de', 'Dateien', 'fm-lab UI', NULL, 800),
    ('import.Dateien', 'import_metric', 'en', 'Files', 'fm-lab UI', NULL, 800),
    ('import.Letzter Import', 'import_metric', 'de', 'Letzter Import', 'fm-lab UI', NULL, 810),
    ('import.Letzter Import', 'import_metric', 'en', 'Last import', 'fm-lab UI', NULL, 810)
) AS labels(Label_Key, Label_Domain, Language_Code, Label_Text, Source_Title, Source_URL, Sort_Order);

CREATE VIEW LocalizationLabelsPivot AS
SELECT
  Label_Key,
  Label_Domain,
  MAX(CASE WHEN Language_Code = 'de' THEN Label_Text END) AS Label_DE,
  MAX(CASE WHEN Language_Code = 'en' THEN Label_Text END) AS Label_EN,
  MAX(Source_Title) AS Source_Title,
  MAX(Source_URL) AS Source_URL,
  MIN(Sort_Order) AS Sort_Order
FROM LocalizationLabels
GROUP BY Label_Key, Label_Domain;

CREATE VIEW AnalysisDashboardLocalized AS
WITH keyed AS (
  SELECT
    d.*,
    'section.' || d.Section AS Section_Label_Key,
    CASE
      WHEN d.Section = 'Objekte' THEN 'object.' || d.Metric_Key
      WHEN d.Section = 'Qualität' THEN 'area.' || d.Metric_Key
      WHEN d.Section = 'Layout-Prüfung' THEN 'layout_issue.' || d.Metric_Key
      WHEN d.Section = 'Zugangsdaten' THEN 'credential.' || d.Metric_Key
      WHEN d.Section = 'Import' THEN 'import.' || d.Metric_Key
      ELSE d.Metric_Key
    END AS Metric_Label_Key
  FROM AnalysisDashboard d
)
SELECT
  k.Section,
  k.Metric_Key,
  k.Metric_Value,
  k.Sort_Order,
  k.Section_Label_Key,
  COALESCE(s.Label_DE, k.Section) AS Section_Label_DE,
  COALESCE(s.Label_EN, k.Section) AS Section_Label_EN,
  k.Metric_Label_Key,
  COALESCE(m.Label_DE, k.Metric_Key) AS Metric_Label_DE,
  COALESCE(m.Label_EN, k.Metric_Key) AS Metric_Label_EN,
  m.Source_Title AS Metric_Source_Title,
  m.Source_URL AS Metric_Source_URL
FROM keyed k
LEFT JOIN LocalizationLabelsPivot s
  ON s.Label_Key = k.Section_Label_Key
LEFT JOIN LocalizationLabelsPivot m
  ON m.Label_Key = k.Metric_Label_Key;

CREATE VIEW QualityFindingsLocalized AS
SELECT
  q.*,
  COALESCE(area.Label_DE, q.Area) AS Area_Label_DE,
  COALESCE(area.Label_EN, q.Area) AS Area_Label_EN,
  COALESCE(obj.Label_DE, q.Object_Type) AS Object_Type_Label_DE,
  COALESCE(obj.Label_EN, q.Object_Type) AS Object_Type_Label_EN,
  COALESCE(rel.Label_DE, q.Related_Type) AS Related_Type_Label_DE,
  COALESCE(rel.Label_EN, q.Related_Type) AS Related_Type_Label_EN
FROM QualityFindings q
LEFT JOIN LocalizationLabelsPivot area
  ON area.Label_Key = 'area.' || q.Area
LEFT JOIN LocalizationLabelsPivot obj
  ON obj.Label_Key = 'object.' || q.Object_Type
LEFT JOIN LocalizationLabelsPivot rel
  ON rel.Label_Key = 'object.' || q.Related_Type;
