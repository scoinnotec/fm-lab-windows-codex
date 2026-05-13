/*
-- DuckDB SQL Script to parse FileMaker XML Catalog
-- and extract various catalog information into tables.

-- XML File must be converted to UTF-8 encoding beforehand!

-- Version 0.4
-- Date: 2026-01-14

-- Schema-Versionierung (siehe project/prd_schema_versioning_auto_heal.md):
--   @SCHEMA_VERSION wird vom Shell-Skript per grep ausgewertet und gegen den
--   Wert in der DB-Tabelle SchemaInfo verglichen. Bei Mismatch löst der
--   Auto-Heal-Mechanismus einen Force-Rebuild aus.
--
--   @SCHEMA_HASH_FILES listet die SQL-Files, deren MD5-Summe als sekundärer
--   Drift-Indikator herangezogen wird. build_resolutions.sql bewusst NICHT
--   enthalten, weil es nur abgeleitete Tabellen anlegt.

-- @SCHEMA_VERSION 1.0.0
-- @SCHEMA_VERSION_DATE 2026-05-13
-- @SCHEMA_HASH_FILES sql/convert_xml.sql sql/create_universal_catalogs.sql
*/


INSTALL webbed FROM community;
LOAD webbed;

-- json_escape() Macro entfernt: xml_to_json() wird nicht mehr verwendet.
-- Stattdessen speichern wir rohes XML (Object_XML, Parameters_XML, Menu_XML, Theme_XML)
-- und extrahieren Werte direkt per xml_extract_text().

-- Pfad zur XML-Datei. Env-Variable FM_XML_DIR überschreibt den Default
-- 'xml' (relativ zum aktuellen Arbeitsverzeichnis). Das convert-xml-Skill-
-- Skript setzt FM_XML_DIR auf ein temporäres Verzeichnis.
SET file_search_path = COALESCE(NULLIF(getenv('FM_XML_DIR'), ''), 'xml');
SET VARIABLE fm_xml = 'Test.xml';  -- Wird durch Skill-Script ersetzt

-- Schema-Marker (werden vom Shell-Skript zur Build-Zeit ersetzt; siehe
-- Header-Kommentar @SCHEMA_VERSION / @SCHEMA_HASH_FILES und §5.2 des PRD).
-- Die SchemaInfo-Tabelle (s. u.) wird am Ende des Imports mit diesen Werten
-- befüllt, sodass folgende Läufe Drift detektieren können.
SET VARIABLE schema_version = '1.0.0';   -- Wird durch Skill-Script ersetzt
SET VARIABLE schema_hash = 'pending';    -- Wird durch Skill-Script ersetzt
SET VARIABLE schema_notes = 'convert_xml.sql import';

-- maximale Speichergröße für read_xml erhöhen (Standard: 16MB)
SET VARIABLE max_filesize TO 256000000; -- 256 MB


-- ========================================
-- SchemaInfo (Versions-Persistenz)
-- ========================================
-- Speichert den Schema-Stand (Version + Content-Hash + Timestamp) nach jedem
-- erfolgreichen Import. Wird vom convert_fm_xml.sh-Skript zur Drift-Detection
-- gelesen. Historie bleibt erhalten — aktueller Stand =
-- arg_max(SchemaInfo.* ORDER BY Schema_Built_At).
CREATE TABLE IF NOT EXISTS SchemaInfo (
    Schema_Version VARCHAR NOT NULL,
    Schema_Hash VARCHAR NOT NULL,
    Schema_Built_At TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    Builder_Notes VARCHAR,
    PRIMARY KEY (Schema_Version, Schema_Hash, Schema_Built_At)
);


-- ========================================
-- XML Metadata (Root-Attribut-Informationen)
-- ========================================
-- Tabelle für XML-Metadaten aller importierten Dateien
-- HINWEIS: Diese Daten sind auch in FilesCatalog verfügbar,
-- XMLMetadata wird aus historischen Gründen beibehalten
CREATE TABLE IF NOT EXISTS XMLMetadata (
    Has_DDR_INFO VARCHAR,
    XML_Version VARCHAR,
    FileMaker_Version VARCHAR,
    Filename VARCHAR,
    File_UUID VARCHAR,
    Locale VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (File_UUID, File_Name)
);

-- XMLMetadata befüllen (mit CTE für File_Name)
WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO XMLMetadata
SELECT
    COALESCE(xml_extract_text(xml, '/FMSaveAsXML/@Has_DDR_INFO')[1], 'False') as Has_DDR_INFO,
    xml_extract_text(xml, '/FMSaveAsXML/@version')[1] as XML_Version,
    xml_extract_text(xml, '/FMSaveAsXML/@Source')[1] as FileMaker_Version,
    xml_extract_text(xml, '/FMSaveAsXML/@File')[1] as Filename,
    xml_extract_text(xml, '/FMSaveAsXML/@UUID')[1] as File_UUID,
    xml_extract_text(xml, '/FMSaveAsXML/@locale')[1] as Locale,
    fn.File_Name as File_Name
FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
CROSS JOIN filename_normalized fn
ON CONFLICT (File_UUID, File_Name) DO UPDATE SET
    Has_DDR_INFO = EXCLUDED.Has_DDR_INFO,
    XML_Version = EXCLUDED.XML_Version,
    FileMaker_Version = EXCLUDED.FileMaker_Version,
    Filename = EXCLUDED.Filename,
    Locale = EXCLUDED.Locale;


-- ========================================
-- FilesCatalog (Multi-File Support)
-- ========================================
-- Tabelle für Metadaten aller importierten FileMaker-Dateien
-- Wird bei jedem Import aktualisiert (UPSERT)
CREATE TABLE IF NOT EXISTS FilesCatalog (
    File_Name VARCHAR PRIMARY KEY,          -- Dateiname ohne .fmp12 Suffix
    File_FullName VARCHAR,                  -- Dateiname mit .fmp12 Suffix
    File_UUID VARCHAR UNIQUE,               -- UUID der Datei (aus XML)
    FileMaker_Version VARCHAR,              -- FileMaker Version (z.B. "ProAdvanced 21.0.2.206")
    Has_DDR_INFO BOOLEAN DEFAULT FALSE,     -- DDR-Info verfügbar?
    Import_Timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- Zeitpunkt des letzten Imports
    XML_Path VARCHAR                        -- Pfad zur XML-Quelldatei
);

-- FilesCatalog befüllen (UPSERT bei wiederholten Importen)
INSERT INTO FilesCatalog (File_Name, File_FullName, File_UUID, FileMaker_Version, Has_DDR_INFO, Import_Timestamp, XML_Path)
SELECT
    -- File_Name: Ohne Suffix (Primary Key)
    regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
        '\.fmp12$',
        ''
    ) as File_Name,

    -- File_FullName: Mit Suffix (Original aus XML)
    xml_extract_text(xml, '/FMSaveAsXML/@File')[1] as File_FullName,

    -- Weitere Metadaten aus XML Root-Element
    xml_extract_text(xml, '/FMSaveAsXML/@UUID')[1] as File_UUID,
    xml_extract_text(xml, '/FMSaveAsXML/@Source')[1] as FileMaker_Version,
    COALESCE(xml_extract_text(xml, '/FMSaveAsXML/@Has_DDR_INFO')[1], 'False') = 'True' as Has_DDR_INFO,
    CURRENT_TIMESTAMP as Import_Timestamp,
    getvariable('fm_xml') as XML_Path
FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
ON CONFLICT (File_Name) DO UPDATE SET
    Import_Timestamp = EXCLUDED.Import_Timestamp,
    FileMaker_Version = EXCLUDED.FileMaker_Version,
    Has_DDR_INFO = EXCLUDED.Has_DDR_INFO,
    XML_Path = EXCLUDED.XML_Path;


-- ExternalDataSourceCatalog
CREATE TABLE IF NOT EXISTS ExternalDataSourceCatalog (
    DS_ID BIGINT,
    DS_Name VARCHAR,
    DS_Type VARCHAR,
    Path VARCHAR,
    DS_UUID VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (DS_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO ExternalDataSourceCatalog
SELECT
    id AS DS_ID,
    name AS DS_Name,
    type AS DS_Type,
    File.UniversalPathList AS Path,
    UUID->>'#text' AS DS_UUID,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='ExternalDataSourceCatalog',
    record_element='ExternalDataSource',
    max_depth=10,
    maximum_file_size=getvariable('max_filesize'),
    columns={
        'id': 'BIGINT',
        'name': 'VARCHAR',
        'type': 'VARCHAR',
        'File': 'STRUCT(UniversalPathList VARCHAR)',
        'UUID': 'STRUCT("#text" VARCHAR, "accountName" VARCHAR, "modifications" BIGINT, "timestamp" VARCHAR, "userName" VARCHAR)'
    }
)
CROSS JOIN filename_normalized fn
ON CONFLICT (DS_UUID, File_Name) DO UPDATE SET
    DS_ID = EXCLUDED.DS_ID,
    DS_Name = EXCLUDED.DS_Name,
    DS_Type = EXCLUDED.DS_Type,
    Path = EXCLUDED.Path;


-- BaseTableCatalog
CREATE TABLE IF NOT EXISTS BaseTableCatalog (
    BT_ID BIGINT,
    BT_Name VARCHAR,
    BT_UUID VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (BT_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO BaseTableCatalog
SELECT
    id AS BT_ID,
    name AS BT_Name,
    UUID->>'#text' AS BT_UUID,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='BaseTableCatalog',
    record_element='BaseTable',
    maximum_file_size=getvariable('max_filesize'),
    columns={
        'id': 'BIGINT',
        'name': 'VARCHAR',
        'UUID': 'STRUCT("#text" VARCHAR, "modifications" BIGINT, "userName" VARCHAR, "accountName" VARCHAR, "timestamp" VARCHAR)'
    }
)
CROSS JOIN filename_normalized fn
ON CONFLICT (BT_UUID, File_Name) DO UPDATE SET
    BT_ID = EXCLUDED.BT_ID,
    BT_Name = EXCLUDED.BT_Name;


-- TableOccurrenceCatalog
CREATE TABLE IF NOT EXISTS TableOccurrenceCatalog (
    TO_ID BIGINT,
    TO_Name VARCHAR,
    TO_Type VARCHAR,
    TO_UUID VARCHAR,
    DS_ID BIGINT,
    DS_Name VARCHAR,
    DS_UUID VARCHAR,
    BT_ID BIGINT,
    BT_Name VARCHAR,
    BT_UUID VARCHAR,
    View_State VARCHAR,
    Box_Height INTEGER,
    Coord_Top INTEGER,
    Coord_Left INTEGER,
    Coord_Bottom INTEGER,
    Coord_Right INTEGER,
    Color_R INTEGER,
    Color_G INTEGER,
    Color_B INTEGER,
    Color_Alpha DOUBLE,
    File_Name VARCHAR,
    PRIMARY KEY (TO_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO TableOccurrenceCatalog (
    TO_ID, TO_Name, TO_Type, TO_UUID,
    DS_ID, DS_Name, DS_UUID,
    BT_ID, BT_Name, BT_UUID,
    View_State, Box_Height,
    Coord_Top, Coord_Left, Coord_Bottom, Coord_Right,
    Color_R, Color_G, Color_B, Color_Alpha,
    File_Name
)
SELECT
    id AS TO_ID,
    name AS TO_Name,
    type AS TO_Type,
    UUID->>'#text' AS TO_UUID,
    BaseTableSourceReference.DataSourceReference.id AS DS_ID,
    BaseTableSourceReference.DataSourceReference.name AS DS_Name,
    BaseTableSourceReference.DataSourceReference.UUID AS DS_UUID,
    BaseTableSourceReference.BaseTableReference.id AS BT_ID,
    BaseTableSourceReference.BaseTableReference.name AS BT_Name,
    BaseTableSourceReference.BaseTableReference.UUID AS BT_UUID,
    View AS View_State,
    height AS Box_Height,
    CoordRect.top AS Coord_Top,
    CoordRect."left" AS Coord_Left,
    CoordRect.bottom AS Coord_Bottom,
    CoordRect."right" AS Coord_Right,
    Color.red AS Color_R,
    Color.green AS Color_G,
    Color.blue AS Color_B,
    Color.alpha AS Color_Alpha,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='TableOccurrenceCatalog',
    record_element='TableOccurrence',
    max_depth=10,
    maximum_file_size=getvariable('max_filesize'),
    columns={
        'id': 'BIGINT',
        'name': 'VARCHAR',
        'type': 'VARCHAR',
        'View': 'VARCHAR',
        'height': 'INTEGER',
        'UUID': 'STRUCT("#text" VARCHAR, "accountName" VARCHAR, "modifications" BIGINT, "timestamp" VARCHAR, "userName" VARCHAR)',
        'BaseTableSourceReference': 'STRUCT(
            "DataSourceReference" STRUCT(
                "id" BIGINT,
                "name" VARCHAR,
                "UUID" VARCHAR
            ),
            "BaseTableReference" STRUCT(
                "id" BIGINT,
                "name" VARCHAR,
                "UUID" VARCHAR
            )
        )',
        'CoordRect': 'STRUCT("top" INTEGER, "left" INTEGER, "bottom" INTEGER, "right" INTEGER)',
        'Color': 'STRUCT("red" INTEGER, "green" INTEGER, "blue" INTEGER, "alpha" DOUBLE)'
    }
)
CROSS JOIN filename_normalized fn
ON CONFLICT (TO_UUID, File_Name) DO UPDATE SET
    TO_ID = EXCLUDED.TO_ID,
    TO_Name = EXCLUDED.TO_Name,
    TO_Type = EXCLUDED.TO_Type,
    DS_ID = EXCLUDED.DS_ID,
    DS_Name = EXCLUDED.DS_Name,
    DS_UUID = EXCLUDED.DS_UUID,
    BT_ID = EXCLUDED.BT_ID,
    BT_Name = EXCLUDED.BT_Name,
    BT_UUID = EXCLUDED.BT_UUID,
    View_State = EXCLUDED.View_State,
    Box_Height = EXCLUDED.Box_Height,
    Coord_Top = EXCLUDED.Coord_Top,
    Coord_Left = EXCLUDED.Coord_Left,
    Coord_Bottom = EXCLUDED.Coord_Bottom,
    Coord_Right = EXCLUDED.Coord_Right,
    Color_R = EXCLUDED.Color_R,
    Color_G = EXCLUDED.Color_G,
    Color_B = EXCLUDED.Color_B,
    Color_Alpha = EXCLUDED.Color_Alpha;


-- RelationshipCatalog
CREATE TABLE IF NOT EXISTS RelationshipCatalog (
    Rel_ID BIGINT,
    Left_TO_Name VARCHAR,
    Left_TO_ID BIGINT,
    Left_TO_UUID VARCHAR,
    Left_Delete BOOLEAN,
    Left_Create BOOLEAN,
    Right_TO_Name VARCHAR,
    Right_TO_ID BIGINT,
    Right_TO_UUID VARCHAR,
    Right_Delete BOOLEAN,
    Right_Create BOOLEAN,
    Operator VARCHAR,
    Left_Field_Name VARCHAR,
    Left_Field_ID BIGINT,
    Left_Field_UUID VARCHAR,
    Left_Field_TO_Name VARCHAR,
    Left_Field_TO_UUID VARCHAR,
    Right_Field_Name VARCHAR,
    Right_Field_ID BIGINT,
    Right_Field_UUID VARCHAR,
    Right_Field_TO_Name VARCHAR,
    Right_Field_TO_UUID VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Rel_ID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO RelationshipCatalog
SELECT
    id AS Rel_ID,
    LeftTable.TableOccurrenceReference.name AS Left_TO_Name,
    LeftTable.TableOccurrenceReference.id AS Left_TO_ID,
    LeftTable.TableOccurrenceReference.UUID AS Left_TO_UUID,
    LeftTable.cascadeDelete AS Left_Delete,
    LeftTable.cascadeCreate AS Left_Create,
    RightTable.TableOccurrenceReference.name AS Right_TO_Name,
    RightTable.TableOccurrenceReference.id AS Right_TO_ID,
    RightTable.TableOccurrenceReference.UUID AS Right_TO_UUID,
    RightTable.cascadeDelete AS Right_Delete,
    RightTable.cascadeCreate AS Right_Create,
    p.type AS Operator,
    p.LeftField.FieldReference.name AS Left_Field_Name,
    p.LeftField.FieldReference.id AS Left_Field_ID,
    p.LeftField.FieldReference.UUID AS Left_Field_UUID,
    p.LeftField.FieldReference.TableOccurrenceReference.name AS Left_Field_TO_Name,
    p.LeftField.FieldReference.TableOccurrenceReference.UUID AS Left_Field_TO_UUID,
    p.RightField.FieldReference.name AS Right_Field_Name,
    p.RightField.FieldReference.id AS Right_Field_ID,
    p.RightField.FieldReference.UUID AS Right_Field_UUID,
    p.RightField.FieldReference.TableOccurrenceReference.name AS Right_Field_TO_Name,
    p.RightField.FieldReference.TableOccurrenceReference.UUID AS Right_Field_TO_UUID,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='RelationshipCatalog',
    record_element='Relationship',
    max_depth=10,
    maximum_file_size=getvariable('max_filesize'),
    columns={
        'id': 'BIGINT',
        'LeftTable': 'STRUCT(
            cascadeCreate BOOLEAN,
            cascadeDelete BOOLEAN,
            "TableOccurrenceReference" STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR)
        )',
        'RightTable': 'STRUCT(
            cascadeCreate BOOLEAN,
            cascadeDelete BOOLEAN,
            "TableOccurrenceReference" STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR)
        )',
        'JoinPredicateList': 'STRUCT(
            "JoinPredicate" STRUCT(
                type VARCHAR,
                "LeftField" STRUCT(
                    FieldReference STRUCT(
                        id BIGINT, name VARCHAR, UUID VARCHAR,
                        "TableOccurrenceReference" STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR)
                    )
                ),
                "RightField" STRUCT(
                    FieldReference STRUCT(
                        id BIGINT, name VARCHAR, UUID VARCHAR,
                        "TableOccurrenceReference" STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR)
                    )
                )
            )[]
        )'
    }
)
CROSS JOIN UNNEST(JoinPredicateList.JoinPredicate) AS t(p)
CROSS JOIN filename_normalized fn
WHERE p.LeftField.FieldReference.UUID IS NOT NULL
  AND p.RightField.FieldReference.UUID IS NOT NULL
ON CONFLICT (Rel_ID, File_Name) DO UPDATE SET
    Left_TO_Name = EXCLUDED.Left_TO_Name,
    Left_TO_ID = EXCLUDED.Left_TO_ID,
    Left_TO_UUID = EXCLUDED.Left_TO_UUID,
    Left_Delete = EXCLUDED.Left_Delete,
    Left_Create = EXCLUDED.Left_Create,
    Right_TO_Name = EXCLUDED.Right_TO_Name,
    Right_TO_ID = EXCLUDED.Right_TO_ID,
    Right_TO_UUID = EXCLUDED.Right_TO_UUID,
    Right_Delete = EXCLUDED.Right_Delete,
    Right_Create = EXCLUDED.Right_Create,
    Operator = EXCLUDED.Operator,
    Left_Field_Name = EXCLUDED.Left_Field_Name,
    Left_Field_ID = EXCLUDED.Left_Field_ID,
    Left_Field_TO_Name = EXCLUDED.Left_Field_TO_Name,
    Left_Field_TO_UUID = EXCLUDED.Left_Field_TO_UUID,
    Right_Field_Name = EXCLUDED.Right_Field_Name,
    Right_Field_ID = EXCLUDED.Right_Field_ID,
    Right_Field_TO_Name = EXCLUDED.Right_Field_TO_Name,
    Right_Field_TO_UUID = EXCLUDED.Right_Field_TO_UUID;


-- FieldsForTables
CREATE TABLE IF NOT EXISTS FieldsForTables (
    Table_ID BIGINT,
    Table_Name VARCHAR,
    Table_UUID VARCHAR,
    Field_ID BIGINT,
    Field_Name VARCHAR,
    Field_Type VARCHAR,
    Data_Type VARCHAR,
    Field_Comment VARCHAR,
    Field_UUID VARCHAR,
    Is_Global BOOLEAN,
    Max_Repetitions INTEGER,
    DDR_Hash VARCHAR,  -- DDR-Hash für Calculated Fields (ab FM21+)
    Calculation_Text VARCHAR,  -- Klartext-Formel aus <Text> CDATA (vollständiger als ChunkList)
    -- AutoEnter-Basisattribute (alle Typen)
    AutoEnter_Type VARCHAR,              -- 'Looked_up', 'SerialNumber', 'Calculated', 'ConstantData', etc.
    AutoEnter_ProhibitMod BOOLEAN,       -- Benutzer darf überschreiben?
    -- Lookup-Details (nur für AutoEnter_Type = 'Looked_up')
    Lookup_Field_Name VARCHAR,           -- Name des Quellfeldes
    Lookup_Field_UUID VARCHAR,           -- UUID des Quellfeldes
    Lookup_TO_Name VARCHAR,              -- Name der Beziehungs-TO
    Lookup_TO_UUID VARCHAR,              -- UUID der Beziehungs-TO
    Lookup_DontCopyIfEmpty BOOLEAN,      -- Leerwerte nicht übernehmen?
    Lookup_NoMatchOption VARCHAR,        -- 'DoNotCopy' oder 'ConstantData'
    -- AutoEnter Calculated-Details (nur für AutoEnter_Type = 'Calculated')
    AE_Calc_Text VARCHAR,               -- Klartext-Formel (komplementär zu Calculation_Text)
    AE_Calc_Hash VARCHAR,               -- DDR-Hash (komplementär zu DDR_Hash)
    AE_Calc_OverwriteExisting BOOLEAN,  -- Vorhandene Werte überschreiben?
    AE_Calc_AlwaysEvaluate BOOLEAN,     -- Bei jeder Änderung neu berechnen?
    -- ConstantData (nur für AutoEnter_Type = 'ConstantData')
    AE_ConstantData VARCHAR,            -- Fester Standardwert
    File_Name VARCHAR,
    PRIMARY KEY (Field_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO FieldsForTables
SELECT
    BaseTableReference.id AS Table_ID,
    BaseTableReference.name AS Table_Name,
    BaseTableReference.UUID AS Table_UUID,
    f.id AS Field_ID,
    f.name AS Field_Name,
    f.fieldtype AS Field_Type,
    f.datatype AS Data_Type,
    f.comment AS Field_Comment,
    f.UUID."#text" AS Field_UUID,
    f.Storage.global AS Is_Global,
    f.Storage.maxRepetitions AS Max_Repetitions,
    f.Calculation.DDRREF.hash AS DDR_Hash,  -- DDR-Hash für Calculated Fields (ab FM21+)
    -- chr(127) -> chr(10): Preprocessing-Sentinel für CR zurück zu LF
    replace(f.Calculation.Text, chr(127), chr(10)) AS Calculation_Text,
    -- AutoEnter-Basisattribute
    CASE WHEN f.AutoEnter.type = '' THEN NULL ELSE f.AutoEnter.type END AS AutoEnter_Type,
    f.AutoEnter.prohibitModification AS AutoEnter_ProhibitMod,
    -- Lookup-Details
    f.AutoEnter.Looked_up.FieldReference.name AS Lookup_Field_Name,
    f.AutoEnter.Looked_up.FieldReference.UUID AS Lookup_Field_UUID,
    f.AutoEnter.Looked_up.FieldReference.TableOccurrenceReference.name AS Lookup_TO_Name,
    f.AutoEnter.Looked_up.FieldReference.TableOccurrenceReference.UUID AS Lookup_TO_UUID,
    f.AutoEnter.Looked_up.dontCopyIfEmpty AS Lookup_DontCopyIfEmpty,
    f.AutoEnter.Looked_up.noMatchCopyOption AS Lookup_NoMatchOption,
    -- AutoEnter Calculated-Details
    replace(f.AutoEnter.Calculated.Calculation.Text, chr(127), chr(10)) AS AE_Calc_Text,
    f.AutoEnter.Calculated.Calculation.DDRREF.hash AS AE_Calc_Hash,
    f.AutoEnter.overwriteExisting AS AE_Calc_OverwriteExisting,
    f.AutoEnter.alwaysEvaluate AS AE_Calc_AlwaysEvaluate,
    -- ConstantData
    f.AutoEnter.ConstantData AS AE_ConstantData,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='FieldsForTables',
    record_element='FieldCatalog',
    max_depth=10,
    maximum_file_size=getvariable('max_filesize'),
    columns={
        'BaseTableReference': 'STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR)',
        'ObjectList': 'STRUCT(
            "Field" STRUCT(
                "id" BIGINT,
                "name" VARCHAR,
                "fieldtype" VARCHAR,
                "datatype" VARCHAR,
                "comment" VARCHAR,
                "UUID" STRUCT("#text" VARCHAR),
                "Storage" STRUCT("global" BOOLEAN, "maxRepetitions" INTEGER),
                "Calculation" STRUCT("DDRREF" STRUCT("hash" VARCHAR), "Text" VARCHAR),
                "AutoEnter" STRUCT(
                    "type" VARCHAR,
                    "prohibitModification" BOOLEAN,
                    "overwriteExisting" BOOLEAN,
                    "alwaysEvaluate" BOOLEAN,
                    "ConstantData" VARCHAR,
                    "Looked_up" STRUCT(
                        "dontCopyIfEmpty" BOOLEAN,
                        "noMatchCopyOption" VARCHAR,
                        "FieldReference" STRUCT(
                            "id" BIGINT,
                            "name" VARCHAR,
                            "UUID" VARCHAR,
                            "TableOccurrenceReference" STRUCT(
                                "id" BIGINT,
                                "name" VARCHAR,
                                "UUID" VARCHAR
                            )
                        )
                    ),
                    "Calculated" STRUCT(
                        "Calculation" STRUCT(
                            "DDRREF" STRUCT("hash" VARCHAR),
                            "Text" VARCHAR
                        )
                    )
                )
            )[]
        )'
    }
)
CROSS JOIN UNNEST(ObjectList.Field) AS t(f)
CROSS JOIN filename_normalized fn
WHERE f.id IS NOT NULL
  AND f.UUID."#text" IS NOT NULL
ON CONFLICT (Field_UUID, File_Name) DO UPDATE SET
    Table_ID = EXCLUDED.Table_ID,
    Table_Name = EXCLUDED.Table_Name,
    Table_UUID = EXCLUDED.Table_UUID,
    Field_ID = EXCLUDED.Field_ID,
    Field_Name = EXCLUDED.Field_Name,
    Field_Type = EXCLUDED.Field_Type,
    Data_Type = EXCLUDED.Data_Type,
    Field_Comment = EXCLUDED.Field_Comment,
    Is_Global = EXCLUDED.Is_Global,
    Max_Repetitions = EXCLUDED.Max_Repetitions,
    DDR_Hash = EXCLUDED.DDR_Hash,
    Calculation_Text = EXCLUDED.Calculation_Text,
    AutoEnter_Type = EXCLUDED.AutoEnter_Type,
    AutoEnter_ProhibitMod = EXCLUDED.AutoEnter_ProhibitMod,
    Lookup_Field_Name = EXCLUDED.Lookup_Field_Name,
    Lookup_Field_UUID = EXCLUDED.Lookup_Field_UUID,
    Lookup_TO_Name = EXCLUDED.Lookup_TO_Name,
    Lookup_TO_UUID = EXCLUDED.Lookup_TO_UUID,
    Lookup_DontCopyIfEmpty = EXCLUDED.Lookup_DontCopyIfEmpty,
    Lookup_NoMatchOption = EXCLUDED.Lookup_NoMatchOption,
    AE_Calc_Text = EXCLUDED.AE_Calc_Text,
    AE_Calc_Hash = EXCLUDED.AE_Calc_Hash,
    AE_Calc_OverwriteExisting = EXCLUDED.AE_Calc_OverwriteExisting,
    AE_Calc_AlwaysEvaluate = EXCLUDED.AE_Calc_AlwaysEvaluate,
    AE_ConstantData = EXCLUDED.AE_ConstantData;


-- ValueListCatalog
CREATE TABLE IF NOT EXISTS ValueListCatalog (
    VL_ID BIGINT,
    VL_Name VARCHAR,
    Source_Type VARCHAR,
    VL_UUID VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (VL_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO ValueListCatalog
SELECT
    id AS VL_ID,
    name AS VL_Name,
    Source.value AS Source_Type,
    UUID."#text" AS VL_UUID,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='ValueListCatalog',
    record_element='ValueList',
    max_depth=10,
    maximum_file_size=getvariable('max_filesize'),
    columns={
        'id': 'BIGINT',
        'name': 'VARCHAR',
        'UUID': 'STRUCT("#text" VARCHAR, "modifications" BIGINT, "userName" VARCHAR, "accountName" VARCHAR, "timestamp" VARCHAR)',
        'Source': 'STRUCT(value VARCHAR)'
    }
)
CROSS JOIN filename_normalized fn
WHERE id IS NOT NULL
ON CONFLICT (VL_UUID, File_Name) DO UPDATE SET
    VL_ID = EXCLUDED.VL_ID,
    VL_Name = EXCLUDED.VL_Name,
    Source_Type = EXCLUDED.Source_Type;


-- OptionsForValueLists (Details und Werte)
CREATE TABLE IF NOT EXISTS OptionsForValueLists (
    VL_ID BIGINT,
    VL_Name VARCHAR,
    VL_UUID VARCHAR,
    Source_Type VARCHAR,
    Custom_Values VARCHAR[],
    Field_ID BIGINT,
    Field_Name VARCHAR,
    Field_UUID VARCHAR,
    TO_ID BIGINT,
    TO_Name VARCHAR,
    TO_UUID VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (VL_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO OptionsForValueLists
SELECT
    ValueListReference.id AS VL_ID,
    ValueListReference.name AS VL_Name,
    ValueListReference.UUID AS VL_UUID,
    Source.value AS Source_Type,
    [v."#text" for v in CustomValues.Text] AS Custom_Values,
    Source.FieldReference.id AS Field_ID,
    Source.FieldReference.name AS Field_Name,
    Source.FieldReference.UUID AS Field_UUID,
    Source.FieldReference.TableOccurrenceReference.id AS TO_ID,
    Source.FieldReference.TableOccurrenceReference.name AS TO_Name,
    Source.FieldReference.TableOccurrenceReference.UUID AS TO_UUID,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='OptionsForValueLists',
    record_element='ValueList',
    max_depth=10,
    maximum_file_size=getvariable('max_filesize'),
    columns={
        'ValueListReference': 'STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR)',
        'Source': 'STRUCT(
            value VARCHAR,
            "FieldReference" STRUCT(
                id BIGINT,
                name VARCHAR,
                UUID VARCHAR,
                "TableOccurrenceReference" STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR)
            )
        )',
        'CustomValues': 'STRUCT("Text" STRUCT("#text" VARCHAR)[])'
    }
)
CROSS JOIN filename_normalized fn
WHERE ValueListReference.id IS NOT NULL
ON CONFLICT (VL_UUID, File_Name) DO UPDATE SET
    VL_ID = EXCLUDED.VL_ID,
    VL_Name = EXCLUDED.VL_Name,
    Source_Type = EXCLUDED.Source_Type,
    Custom_Values = EXCLUDED.Custom_Values,
    Field_ID = EXCLUDED.Field_ID,
    Field_Name = EXCLUDED.Field_Name,
    Field_UUID = EXCLUDED.Field_UUID,
    TO_ID = EXCLUDED.TO_ID,
    TO_Name = EXCLUDED.TO_Name,
    TO_UUID = EXCLUDED.TO_UUID;


-- CustomFunctionsCatalog
CREATE TABLE IF NOT EXISTS CustomFunctionsCatalog (
    CF_ID BIGINT,
    CF_Name VARCHAR,
    CF_Display VARCHAR,
    CF_UUID VARCHAR,
    Parameters VARCHAR[],
    DDR_Hash VARCHAR,  -- DDR-Hash für Custom Functions (ab FM21+)
    File_Name VARCHAR,
    PRIMARY KEY (CF_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO CustomFunctionsCatalog
SELECT
    id AS CF_ID,
    name AS CF_Name,
    Display AS CF_Display,
    UUID->>'#text' AS CF_UUID,
    [p.name for p in ObjectList.Parameter] AS Parameters,
    NULL AS DDR_Hash,  -- Wird später von CalcsForCustomFunctions aktualisiert
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='CustomFunctionsCatalog',
    record_element='CustomFunction',
    max_depth=10,
    maximum_file_size=getvariable('max_filesize'),
    columns={
        'id': 'BIGINT',
        'name': 'VARCHAR',
        'Display': 'VARCHAR',
        'UUID': 'STRUCT("#text" VARCHAR, "modifications" BIGINT, "userName" VARCHAR, "timestamp" VARCHAR)',
        'ObjectList': 'STRUCT(Parameter STRUCT(name VARCHAR)[])'
    }
)
CROSS JOIN filename_normalized fn
ON CONFLICT (CF_UUID, File_Name) DO UPDATE SET
    CF_ID = EXCLUDED.CF_ID,
    CF_Name = EXCLUDED.CF_Name,
    CF_Display = EXCLUDED.CF_Display,
    Parameters = EXCLUDED.Parameters,
    DDR_Hash = EXCLUDED.DDR_Hash;


-- CalcsForCustomFunctions
CREATE TABLE IF NOT EXISTS CalcsForCustomFunctions (
    CF_ID BIGINT,
    CF_Name VARCHAR,
    CF_UUID VARCHAR,
    Calculation_Code VARCHAR,
    Code_Chunks STRUCT(type VARCHAR, content VARCHAR)[],
    DDR_Hash VARCHAR,
    DDR_UUID VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (CF_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO CalcsForCustomFunctions
SELECT
    CustomFunctionReference.id AS CF_ID,
    CustomFunctionReference.name AS CF_Name,
    CustomFunctionReference.UUID AS CF_UUID,
    replace(Calculation.Text, chr(127), chr(10)) AS Calculation_Code,
    [ {'type': c.type, 'content': c."#text"} for c in Calculation.ChunkList.Chunk ] AS Code_Chunks,
    Calculation.DDRREF.hash AS DDR_Hash,
    regexp_replace(
        Calculation.DDRREF."#text",
        '^_',
        ''
    ) AS DDR_UUID,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='CalcsForCustomFunctions',
    record_element='CustomFunctionCalc',
    max_depth=10,
    maximum_file_size=getvariable('max_filesize'),
    columns={
        'CustomFunctionReference': 'STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR)',
        'Calculation': 'STRUCT(
            "Text" VARCHAR,
            "ChunkList" STRUCT(
                "Chunk" STRUCT(type VARCHAR, "#text" VARCHAR)[]
            ),
            "DDRREF" STRUCT(
                "kind" VARCHAR,
                "hash" VARCHAR,
                "#text" VARCHAR
            )
        )'
    }
)
CROSS JOIN filename_normalized fn
ON CONFLICT (CF_UUID, File_Name) DO UPDATE SET
    CF_ID = EXCLUDED.CF_ID,
    CF_Name = EXCLUDED.CF_Name,
    Calculation_Code = EXCLUDED.Calculation_Code,
    Code_Chunks = EXCLUDED.Code_Chunks,
    DDR_Hash = EXCLUDED.DDR_Hash,
    DDR_UUID = EXCLUDED.DDR_UUID;


-- Update CustomFunctionsCatalog with DDR_Hash from CalcsForCustomFunctions
UPDATE CustomFunctionsCatalog cf
SET DDR_Hash = calc.DDR_Hash
FROM CalcsForCustomFunctions calc
WHERE cf.CF_UUID = calc.CF_UUID
  AND cf.File_Name = calc.File_Name
  AND calc.DDR_Hash IS NOT NULL;


-- ScriptCatalog
-- Sequence_ID: laufende Nummer in der XML-Reihenfolge (kritisch für Folder-Hierarchie!).
-- Script_ID ist NICHT die UI-Reihenfolge — FileMaker numeriert Scripts sequentiell beim
-- Anlegen, nicht beim Ordnen. Für korrekte Stack-Berechnung der Folder muss die echte
-- XML-Reihenfolge erhalten bleiben.
CREATE TABLE IF NOT EXISTS ScriptCatalog (
    Script_ID BIGINT,
    Script_Name VARCHAR,
    Folder_Type VARCHAR,
    Is_Separator BOOLEAN,
    Script_UUID VARCHAR,
    Modifications BIGINT,
    Last_Modified_By VARCHAR,
    Last_Modified_At VARCHAR,
    Option_Bitmask INTEGER,
    Is_Hidden BOOLEAN,
    Full_Access BOOLEAN,
    Sequence_ID BIGINT,
    File_Name VARCHAR,
    PRIMARY KEY (Script_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
script_records AS (
    -- Pro Datei: ROW_NUMBER() in der read_xml-Reihenfolge (= XML-Reihenfolge).
    SELECT
        ROW_NUMBER() OVER () AS Sequence_ID,
        id, name, isFolder, isSeparatorItem, UUID, Options
    FROM read_xml(
        getvariable('fm_xml'),
        root_element='ScriptCatalog',
        record_element='Script',
        max_depth=10,
        maximum_file_size=getvariable('max_filesize'),
        columns={
            'id': 'BIGINT',
            'name': 'VARCHAR',
            'isFolder': 'VARCHAR',
            'isSeparatorItem': 'BOOLEAN',
            'UUID': 'STRUCT("#text" VARCHAR, modifications BIGINT, userName VARCHAR, accountName VARCHAR, timestamp VARCHAR)',
            'Options': 'STRUCT("#text" INTEGER, hidden BOOLEAN, access VARCHAR, SiriShortcutVisible BOOLEAN, runwithfullaccess BOOLEAN, compatibility INTEGER)'
        }
    )
    WHERE id IS NOT NULL
)
INSERT INTO ScriptCatalog
SELECT
    sr.id AS Script_ID,
    sr.name AS Script_Name,
    sr.isFolder AS Folder_Type,
    COALESCE(sr.isSeparatorItem, False) AS Is_Separator,
    sr.UUID."#text" AS Script_UUID,
    sr.UUID.modifications AS Modifications,
    sr.UUID.userName AS Last_Modified_By,
    sr.UUID.timestamp AS Last_Modified_At,
    sr.Options."#text" AS Option_Bitmask,
    sr.Options.hidden AS Is_Hidden,
    sr.Options.runwithfullaccess AS Full_Access,
    sr.Sequence_ID,
    fn.File_Name as File_Name
FROM script_records sr
CROSS JOIN filename_normalized fn
ON CONFLICT (Script_UUID, File_Name) DO UPDATE SET
    Script_ID = EXCLUDED.Script_ID,
    Script_Name = EXCLUDED.Script_Name,
    Folder_Type = EXCLUDED.Folder_Type,
    Is_Separator = EXCLUDED.Is_Separator,
    Modifications = EXCLUDED.Modifications,
    Last_Modified_By = EXCLUDED.Last_Modified_By,
    Last_Modified_At = EXCLUDED.Last_Modified_At,
    Option_Bitmask = EXCLUDED.Option_Bitmask,
    Is_Hidden = EXCLUDED.Is_Hidden,
    Full_Access = EXCLUDED.Full_Access,
    Sequence_ID = EXCLUDED.Sequence_ID;


-- StepsForScripts
CREATE TABLE IF NOT EXISTS StepsForScripts (
    Script_ID BIGINT,
    Script_Name VARCHAR,
    Script_UUID VARCHAR,
    Step_Index INTEGER,
    Step_ID INTEGER,
    Step_Name VARCHAR,
    Is_Enabled BOOLEAN,
    Step_UUID VARCHAR,
    DDR_Hash VARCHAR,
    DDR_UUID VARCHAR,
    Parameters_XML VARCHAR,
    Parameter_Type VARCHAR,
    Variable_Name VARCHAR,
    Calculation_Text VARCHAR,
    Boolean_Type VARCHAR,
    Boolean_Value VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Step_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_scripts AS (
    SELECT
        unnest(xml_extract_elements(xml, '//StepsForScripts/Script')) as script_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
script_steps AS (
    SELECT
        xml_extract_text(script_xml, '/Script/ScriptReference/@id')[1]::BIGINT as Script_ID,
        xml_extract_text(script_xml, '/Script/ScriptReference/@name')[1] as Script_Name,
        xml_extract_text(script_xml, '/Script/ScriptReference/@UUID')[1] as Script_UUID,
        unnest(xml_extract_elements(script_xml, '/Script/ObjectList/Step')) as step_xml
    FROM raw_scripts
)
INSERT INTO StepsForScripts
SELECT
    Script_ID,
    Script_Name,
    Script_UUID,
    xml_extract_text(step_xml, '/Step/@index')[1]::INTEGER as Step_Index,
    xml_extract_text(step_xml, '/Step/@id')[1]::INTEGER as Step_ID,
    xml_extract_text(step_xml, '/Step/@name')[1] as Step_Name,
    xml_extract_text(step_xml, '/Step/@enable')[1] = 'True' as Is_Enabled,
    xml_extract_text(step_xml, '/Step/UUID')[1] as Step_UUID,
    xml_extract_text(step_xml, '/Step/DDRREF[@kind="StepText"]/@hash')[1] as DDR_Hash,
    regexp_replace(
        xml_extract_text(step_xml, '/Step/DDRREF[@kind="StepText"]')[1],
        '^_',
        ''
    ) as DDR_UUID,
    xml_extract_elements(step_xml, '/Step/ParameterValues')[1]::VARCHAR as Parameters_XML,
    xml_extract_text(step_xml, '//Parameter/@type')[1] as Parameter_Type,
    xml_extract_text(step_xml, '//Parameter[@type="Variable"]/Name/@value')[1] as Variable_Name,
    replace(xml_extract_text(step_xml, '//Calculation/Text')[1], chr(127), chr(10)) as Calculation_Text,
    xml_extract_text(step_xml, '//Boolean/@type')[1] as Boolean_Type,
    xml_extract_text(step_xml, '//Boolean/@value')[1] as Boolean_Value,
    fn.File_Name as File_Name
FROM script_steps
CROSS JOIN filename_normalized fn
ON CONFLICT (Step_UUID, File_Name) DO UPDATE SET
    Script_ID = EXCLUDED.Script_ID,
    Script_Name = EXCLUDED.Script_Name,
    Script_UUID = EXCLUDED.Script_UUID,
    Step_Index = EXCLUDED.Step_Index,
    Step_ID = EXCLUDED.Step_ID,
    Step_Name = EXCLUDED.Step_Name,
    Is_Enabled = EXCLUDED.Is_Enabled,
    DDR_Hash = EXCLUDED.DDR_Hash,
    DDR_UUID = EXCLUDED.DDR_UUID,
    Parameters_XML = EXCLUDED.Parameters_XML,
    Parameter_Type = EXCLUDED.Parameter_Type,
    Variable_Name = EXCLUDED.Variable_Name,
    Calculation_Text = EXCLUDED.Calculation_Text,
    Boolean_Type = EXCLUDED.Boolean_Type,
    Boolean_Value = EXCLUDED.Boolean_Value;


-- ============================================
-- XMLStepReferences (ersetzt Python extract_xml_references.py)
-- ============================================
-- Extrahiert UUID-Referenzen direkt aus dem XML per xml_extract_text().
-- Kein JSON-Umweg, kein Escaping-Problem.
CREATE TABLE IF NOT EXISTS XMLStepReferences (
    Script_UUID VARCHAR,
    Step_UUID VARCHAR,
    Step_Name VARCHAR,
    Step_Index VARCHAR,
    Ref_Type VARCHAR,            -- 'field' | 'script' | 'layout' | 'variable'
    Ref_UUID VARCHAR,            -- bei Ref_Type='variable': NULL
    Ref_Name VARCHAR,
    File_Name VARCHAR,
    -- v2.0 Erweiterungen (PRD prd_rest_api_token_extended_infos.md §4.3):
    TO_Name VARCHAR,             -- nur Ref_Type='field' (Set Field / GTF / GTRR)
    TO_UUID VARCHAR,             -- analog
    Data_Source_Name VARCHAR,    -- nur Ref_Type='script' Cross-File (Perform Script from file)
    Data_Source_UUID VARCHAR,    -- analog
    Variable_Scope VARCHAR,      -- nur Ref_Type='variable': 'local'|'global'|'superglobal'|'let_local'
    Usage_Type VARCHAR           -- nur Ref_Type='variable': 'set' (Set-Variable-Step-Definition)
);

-- Additive Migration für Bestands-DBs (idempotent — neuer Bau setzt sie via CREATE).
ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS TO_Name VARCHAR;
ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS TO_UUID VARCHAR;
ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS Data_Source_Name VARCHAR;
ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS Data_Source_UUID VARCHAR;
ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS Variable_Scope VARCHAR;
ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS Usage_Type VARCHAR;

-- Bestehende Einträge für diese Datei entfernen (Idempotenz)
DELETE FROM XMLStepReferences WHERE File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
);

-- Perform Script → ScriptReference
WITH filename_normalized AS (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_scripts AS (
    SELECT unnest(xml_extract_elements(xml, '//StepsForScripts/Script')) as script_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
script_steps AS (
    SELECT
        xml_extract_text(script_xml, '/Script/ScriptReference/@UUID')[1] as Script_UUID,
        unnest(xml_extract_elements(script_xml, '/Script/ObjectList/Step')) as step_xml
    FROM raw_scripts
)
INSERT INTO XMLStepReferences
SELECT Script_UUID,
    xml_extract_text(step_xml, '/Step/UUID')[1] as Step_UUID,
    xml_extract_text(step_xml, '/Step/@name')[1] as Step_Name,
    xml_extract_text(step_xml, '/Step/@index')[1] as Step_Index,
    'script' as Ref_Type,
    xml_extract_text(step_xml, '//ScriptReference/@UUID')[1] as Ref_UUID,
    xml_extract_text(step_xml, '//ScriptReference/@name')[1] as Ref_Name,
    fn.File_Name,
    NULL AS TO_Name, NULL AS TO_UUID,
    -- Cross-File-Detection: <DataSourceReference> vor <ScriptReference> markiert externen Aufruf
    -- (PRD §2.5). NULLIF, weil xml_extract_text leere Strings für nicht-existente Elemente liefert.
    NULLIF(xml_extract_text(step_xml, '//DataSourceReference/@name')[1], '') AS Data_Source_Name,
    NULLIF(xml_extract_text(step_xml, '//DataSourceReference/@UUID')[1], '') AS Data_Source_UUID,
    NULL AS Variable_Scope, NULL AS Usage_Type
FROM script_steps CROSS JOIN filename_normalized fn
WHERE xml_extract_text(step_xml, '/Step/@name')[1] LIKE '%Perform Script%'
  AND xml_extract_text(step_xml, '//ScriptReference/@UUID')[1] IS NOT NULL;

-- Alle Step-Typen mit eingebetteten <FieldReference>-Elementen
-- (PRD prd_universal_field_refs_in_steps.md §4.1)
-- Universelle Erfassung: unnest jeder FieldReference im Step-XML → eine Zeile pro
-- Feld. Step-Filter entfällt — XPath '//FieldReference' matched in 22 Step-Typen
-- (Set Field, Sort Records, Import Records, Perform Find, Replace Field Contents,
-- Show Custom Dialog, etc.). TO-Auflösung relativ zur FieldReference, damit Steps
-- mit mehreren Feld-TO-Paaren (Import Records) korrekt aufgelöst werden.
WITH filename_normalized AS (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_scripts AS (
    SELECT unnest(xml_extract_elements(xml, '//StepsForScripts/Script')) as script_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
script_steps AS (
    SELECT
        xml_extract_text(script_xml, '/Script/ScriptReference/@UUID')[1] as Script_UUID,
        unnest(xml_extract_elements(script_xml, '/Script/ObjectList/Step')) as step_xml
    FROM raw_scripts
),
step_field_refs AS (
    SELECT
        Script_UUID,
        xml_extract_text(step_xml, '/Step/UUID')[1] as Step_UUID,
        xml_extract_text(step_xml, '/Step/@name')[1] as Step_Name,
        xml_extract_text(step_xml, '/Step/@index')[1] as Step_Index,
        unnest(xml_extract_elements(step_xml, '//FieldReference')) as field_ref_xml
    FROM script_steps
)
INSERT INTO XMLStepReferences
SELECT
    Script_UUID,
    Step_UUID,
    Step_Name,
    Step_Index,
    'field' as Ref_Type,
    xml_extract_text(field_ref_xml, '/FieldReference/@UUID')[1] as Ref_UUID,
    xml_extract_text(field_ref_xml, '/FieldReference/@name')[1] as Ref_Name,
    fn.File_Name,
    -- TO-Auflösung relativ zum FieldReference-Element (PRD §3.2 / §5.1)
    NULLIF(xml_extract_text(field_ref_xml, '/FieldReference/TableOccurrenceReference/@name')[1], '') AS TO_Name,
    NULLIF(xml_extract_text(field_ref_xml, '/FieldReference/TableOccurrenceReference/@UUID')[1], '') AS TO_UUID,
    NULL AS Data_Source_Name, NULL AS Data_Source_UUID,
    NULL AS Variable_Scope, NULL AS Usage_Type
FROM step_field_refs CROSS JOIN filename_normalized fn
WHERE xml_extract_text(field_ref_xml, '/FieldReference/@UUID')[1] IS NOT NULL;

-- Go to Related Record → TableOccurrenceReference (PRD prd_rest_api_token_gtrr.md §4.1)
-- GTRR enthält kein <FieldReference>; das Ziel ist die TO. Heimat/Cross-File werden
-- im Template über TableOccurrenceResolution aufgelöst (Ref_UUID = TO_UUID, File_Name
-- = Quelldatei des Scripts).
WITH filename_normalized AS (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_scripts AS (
    SELECT unnest(xml_extract_elements(xml, '//StepsForScripts/Script')) as script_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
script_steps AS (
    SELECT
        xml_extract_text(script_xml, '/Script/ScriptReference/@UUID')[1] as Script_UUID,
        unnest(xml_extract_elements(script_xml, '/Script/ObjectList/Step')) as step_xml
    FROM raw_scripts
)
INSERT INTO XMLStepReferences
SELECT Script_UUID,
    xml_extract_text(step_xml, '/Step/UUID')[1] as Step_UUID,
    xml_extract_text(step_xml, '/Step/@name')[1] as Step_Name,
    xml_extract_text(step_xml, '/Step/@index')[1] as Step_Index,
    'tableOccurrence' as Ref_Type,
    xml_extract_text(step_xml, '//TableOccurrenceReference/@UUID')[1] as Ref_UUID,
    xml_extract_text(step_xml, '//TableOccurrenceReference/@name')[1] as Ref_Name,
    fn.File_Name,
    -- TO_Name/TO_UUID-Spalten redundant für tableOccurrence-Refs (Ref_UUID/Ref_Name
    -- enthalten dieselbe Info). NULL hält die Semantik konsistent (TO_* nur für
    -- Field-Refs gefüllt, wo es das *Kontext*-TO eines Felds beschreibt).
    NULL AS TO_Name, NULL AS TO_UUID,
    NULL AS Data_Source_Name, NULL AS Data_Source_UUID,
    NULL AS Variable_Scope, NULL AS Usage_Type
FROM script_steps CROSS JOIN filename_normalized fn
WHERE xml_extract_text(step_xml, '/Step/@name')[1] = 'Go to Related Record'
  AND xml_extract_text(step_xml, '//TableOccurrenceReference/@UUID')[1] IS NOT NULL;

-- Go to Related Record → LayoutReference (PRD prd_rest_api_token_gtrr.md §4.2)
-- Variante A (~92%) hat <LayoutReference> innerhalb von <LayoutReferenceContainer>.
-- Variante B ("original layout") hat nur <LayoutReferenceContainer> mit <Label> —
-- der XPath //LayoutReference/@UUID matcht dann nichts → kein INSERT.
WITH filename_normalized AS (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_scripts AS (
    SELECT unnest(xml_extract_elements(xml, '//StepsForScripts/Script')) as script_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
script_steps AS (
    SELECT
        xml_extract_text(script_xml, '/Script/ScriptReference/@UUID')[1] as Script_UUID,
        unnest(xml_extract_elements(script_xml, '/Script/ObjectList/Step')) as step_xml
    FROM raw_scripts
)
INSERT INTO XMLStepReferences
SELECT Script_UUID,
    xml_extract_text(step_xml, '/Step/UUID')[1] as Step_UUID,
    xml_extract_text(step_xml, '/Step/@name')[1] as Step_Name,
    xml_extract_text(step_xml, '/Step/@index')[1] as Step_Index,
    'layout' as Ref_Type,
    xml_extract_text(step_xml, '//LayoutReference/@UUID')[1] as Ref_UUID,
    xml_extract_text(step_xml, '//LayoutReference/@name')[1] as Ref_Name,
    fn.File_Name,
    NULL AS TO_Name, NULL AS TO_UUID,
    NULL AS Data_Source_Name, NULL AS Data_Source_UUID,
    NULL AS Variable_Scope, NULL AS Usage_Type
FROM script_steps CROSS JOIN filename_normalized fn
WHERE xml_extract_text(step_xml, '/Step/@name')[1] = 'Go to Related Record'
  AND xml_extract_text(step_xml, '//LayoutReference/@UUID')[1] IS NOT NULL;

-- Go to Layout → LayoutReference
WITH filename_normalized AS (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_scripts AS (
    SELECT unnest(xml_extract_elements(xml, '//StepsForScripts/Script')) as script_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
script_steps AS (
    SELECT
        xml_extract_text(script_xml, '/Script/ScriptReference/@UUID')[1] as Script_UUID,
        unnest(xml_extract_elements(script_xml, '/Script/ObjectList/Step')) as step_xml
    FROM raw_scripts
)
INSERT INTO XMLStepReferences
SELECT Script_UUID,
    xml_extract_text(step_xml, '/Step/UUID')[1] as Step_UUID,
    xml_extract_text(step_xml, '/Step/@name')[1] as Step_Name,
    xml_extract_text(step_xml, '/Step/@index')[1] as Step_Index,
    'layout' as Ref_Type,
    xml_extract_text(step_xml, '//LayoutReference/@UUID')[1] as Ref_UUID,
    xml_extract_text(step_xml, '//LayoutReference/@name')[1] as Ref_Name,
    fn.File_Name,
    NULL AS TO_Name, NULL AS TO_UUID,
    NULL AS Data_Source_Name, NULL AS Data_Source_UUID,
    NULL AS Variable_Scope, NULL AS Usage_Type
FROM script_steps CROSS JOIN filename_normalized fn
WHERE xml_extract_text(step_xml, '/Step/@name')[1] = 'Go to Layout'
  AND xml_extract_text(step_xml, '//LayoutReference/@UUID')[1] IS NOT NULL;


-- Set Variable → <Name value="$X"> als Definition (LHS, Usage_Type='set')
-- Die RHS-Lesung kommt über DDR-Calc-Chunks und landet in XMLCalcReferences
-- (Ref_Type='variable', Usage_Type='read'). Damit haben wir saubere Trennung
-- Definition vs. Lesung — Voraussetzung für Cross-Step-Navigation (PRD §2.6).
WITH filename_normalized AS (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_scripts AS (
    SELECT unnest(xml_extract_elements(xml, '//StepsForScripts/Script')) as script_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
script_steps AS (
    SELECT
        xml_extract_text(script_xml, '/Script/ScriptReference/@UUID')[1] as Script_UUID,
        unnest(xml_extract_elements(script_xml, '/Script/ObjectList/Step')) as step_xml
    FROM raw_scripts
)
INSERT INTO XMLStepReferences
SELECT Script_UUID,
    xml_extract_text(step_xml, '/Step/UUID')[1] as Step_UUID,
    xml_extract_text(step_xml, '/Step/@name')[1] as Step_Name,
    xml_extract_text(step_xml, '/Step/@index')[1] as Step_Index,
    'variable' as Ref_Type,
    NULL as Ref_UUID,
    -- <Name value="$X"> liegt unterhalb von ParameterValues/Parameter/Name
    xml_extract_text(step_xml, '//Name/@value')[1] as Ref_Name,
    fn.File_Name,
    NULL AS TO_Name, NULL AS TO_UUID,
    NULL AS Data_Source_Name, NULL AS Data_Source_UUID,
    -- Scope-Detektor: $$$ → superglobal, $$ → global, $ → local. Reihenfolge wichtig
    -- (LIKE '$$$%' muss vor LIKE '$$%' stehen — sonst werden $$$ als $$ erkannt).
    CASE
        WHEN xml_extract_text(step_xml, '//Name/@value')[1] LIKE '$$$%' THEN 'superglobal'
        WHEN xml_extract_text(step_xml, '//Name/@value')[1] LIKE '$$%'  THEN 'global'
        ELSE 'local'
    END AS Variable_Scope,
    'set' AS Usage_Type
FROM script_steps CROSS JOIN filename_normalized fn
WHERE xml_extract_text(step_xml, '/Step/@name')[1] = 'Set Variable'
  AND xml_extract_text(step_xml, '//Name/@value')[1] IS NOT NULL
  AND xml_extract_text(step_xml, '//Name/@value')[1] <> '';


-- Layouts
-- Folder_Type / Is_Separator analog zu ScriptCatalog: Layouts können im
-- "Manage Layouts"-Dialog Ordner und Trennlinien enthalten (isFolder="True"/"Marker").
-- Sequence_ID: laufende Nummer in der XML-Reihenfolge (siehe Hinweis bei ScriptCatalog).
CREATE TABLE IF NOT EXISTS Layouts (
    L_ID BIGINT,
    L_Name VARCHAR,
    L_UUID VARCHAR,
    L_TO_Name VARCHAR,
    Folder_Type VARCHAR,
    Is_Separator BOOLEAN,
    Sequence_ID BIGINT,
    File_Name VARCHAR,
    PRIMARY KEY (L_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
layout_records AS (
    SELECT
        ROW_NUMBER() OVER () AS Sequence_ID,
        id, name, isFolder, isSeparatorItem, UUID, TableOccurrenceReference
    FROM read_xml(
        getvariable('fm_xml'),
        root_element='LayoutCatalog',
        record_element='Layout',
        maximum_file_size=getvariable('max_filesize'),
        columns={
            'id': 'BIGINT',
            'name': 'VARCHAR',
            'isFolder': 'VARCHAR',
            'isSeparatorItem': 'BOOLEAN',
            'UUID': 'STRUCT("#text" VARCHAR)',
            'TableOccurrenceReference': 'STRUCT(name VARCHAR)'
        }
    )
    -- Folder-Records (isFolder='True'/'Marker') haben keine TableOccurrenceReference;
    -- daher nur auf id filtern, sonst werden Ordner und Trennlinien ausgeschlossen.
    WHERE id IS NOT NULL
)
INSERT INTO Layouts
SELECT
    lr.id AS L_ID,
    lr.name AS L_Name,
    lr.UUID."#text" AS L_UUID,
    lr.TableOccurrenceReference.name AS L_TO_Name,
    lr.isFolder AS Folder_Type,
    COALESCE(lr.isSeparatorItem, False) AS Is_Separator,
    lr.Sequence_ID,
    fn.File_Name as File_Name
FROM layout_records lr
CROSS JOIN filename_normalized fn
ON CONFLICT (L_UUID, File_Name) DO UPDATE SET
    L_ID = EXCLUDED.L_ID,
    L_Name = EXCLUDED.L_Name,
    L_TO_Name = EXCLUDED.L_TO_Name,
    Folder_Type = EXCLUDED.Folder_Type,
    Is_Separator = EXCLUDED.Is_Separator,
    Sequence_ID = EXCLUDED.Sequence_ID;


-- LayoutParts
CREATE TABLE IF NOT EXISTS LayoutParts (
    Layout_ID BIGINT,
    Layout_Name VARCHAR,
    Part_Type VARCHAR,
    Part_Kind INTEGER,
    Definition_Type VARCHAR,
    Definition_Kind INTEGER,
    Part_Size INTEGER,
    Part_Absolute INTEGER,
    Part_Options INTEGER,
    Object_Count BIGINT,
    File_Name VARCHAR,
    PRIMARY KEY (Layout_ID, Part_Kind, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_layouts AS (
    SELECT
        unnest(xml_extract_elements(xml, '//LayoutCatalog/Layout')) as layout_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
layout_parts AS (
    SELECT
        xml_extract_text(layout_xml, '/Layout/@id')[1]::BIGINT as Layout_ID,
        xml_extract_text(layout_xml, '/Layout/@name')[1] as Layout_Name,
        unnest(xml_extract_elements(layout_xml, '/Layout/PartsList/Part')) as part_xml
    FROM raw_layouts
    WHERE xml_extract_text(layout_xml, '/Layout/@id')[1] IS NOT NULL
)
INSERT INTO LayoutParts
SELECT
    Layout_ID,
    Layout_Name,
    xml_extract_text(part_xml, '/Part/@type')[1] as Part_Type,
    xml_extract_text(part_xml, '/Part/@kind')[1]::INTEGER as Part_Kind,
    xml_extract_text(part_xml, '/Part/Definition/@type')[1] as Definition_Type,
    xml_extract_text(part_xml, '/Part/Definition/@kind')[1]::INTEGER as Definition_Kind,
    xml_extract_text(part_xml, '/Part/Definition/@size')[1]::INTEGER as Part_Size,
    xml_extract_text(part_xml, '/Part/Definition/@absolute')[1]::INTEGER as Part_Absolute,
    xml_extract_text(part_xml, '/Part/Definition/@Options')[1]::INTEGER as Part_Options,
    list_count(xml_extract_elements(part_xml, '/Part/ObjectList/LayoutObject')) as Object_Count,
    fn.File_Name as File_Name
FROM layout_parts
CROSS JOIN filename_normalized fn
ON CONFLICT (Layout_ID, Part_Kind, File_Name) DO UPDATE SET
    Layout_Name = EXCLUDED.Layout_Name,
    Part_Type = EXCLUDED.Part_Type,
    Definition_Type = EXCLUDED.Definition_Type,
    Definition_Kind = EXCLUDED.Definition_Kind,
    Part_Size = EXCLUDED.Part_Size,
    Part_Absolute = EXCLUDED.Part_Absolute,
    Part_Options = EXCLUDED.Part_Options,
    Object_Count = EXCLUDED.Object_Count;


-- ========================================
-- LayoutObjects
-- ========================================
-- Alle Layout-Objekte mit rekursiver Verschachtelung
-- (Portal, Group, Tab Control, Panel, Container, etc.)
--
-- Verwendet WITH RECURSIVE für verschachtelte Objekte:
-- - Level 0: Root-Objekte direkt in Parts
-- - Level 1+: Verschachtelte Objekte in Portals, Groups, Tab Controls, etc.
-- ========================================

CREATE TABLE IF NOT EXISTS LayoutObjects (
    Layout_ID BIGINT,
    Part_Type VARCHAR,
    Object_ID BIGINT,
    Object_Type VARCHAR,
    Object_Name VARCHAR,
    Object_Kind INTEGER,
    Object_Hash VARCHAR,
    Object_UUID VARCHAR,
    Bounds_Top INTEGER,
    Bounds_Left INTEGER,
    Bounds_Bottom INTEGER,
    Bounds_Right INTEGER,
    Parent_Object_ID BIGINT,
    Nesting_Level INTEGER,
    Z_Order INTEGER,
    Hide_Calculation_Text VARCHAR,
    Tooltip_Calculation_Text VARCHAR,
    Label_Calculation_Text VARCHAR,
    ScriptTrigger_Parameter_Text VARCHAR,
    Text_Content VARCHAR,
    Object_XML VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Object_UUID, File_Name)
);

WITH RECURSIVE filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_layouts AS (
    SELECT
        unnest(xml_extract_elements(xml, '//LayoutCatalog/Layout')) as layout_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
layout_parts AS (
    SELECT
        xml_extract_text(layout_xml, '/Layout/@id')[1]::BIGINT as Layout_ID,
        xml_extract_text(layout_xml, '/Layout/@name')[1] as Layout_Name,
        xml_extract_text(layout_xml, '/Layout/UUID/@*')[1] as Layout_UUID,
        unnest(xml_extract_elements(layout_xml, '/Layout/PartsList/Part')) as part_xml
    FROM raw_layouts
),
root_objects AS (
    SELECT
        Layout_ID,
        xml_extract_text(part_xml, '/Part/@type')[1] as Part_Type,
        xml_extract_text(object_xml, '/LayoutObject/@id')[1]::BIGINT as Object_ID,
        xml_extract_text(object_xml, '/LayoutObject/@type')[1] as Object_Type,
        xml_extract_text(object_xml, '/LayoutObject/@name')[1] as Object_Name,
        xml_extract_text(object_xml, '/LayoutObject/@kind')[1]::INTEGER as Object_Kind,
        xml_extract_text(object_xml, '/LayoutObject/@hash')[1] as Object_Hash,
        xml_extract_text(object_xml, '/LayoutObject/UUID')[1] as Object_UUID,
        xml_extract_text(object_xml, '/LayoutObject/Bounds/@top')[1]::INTEGER as Bounds_Top,
        xml_extract_text(object_xml, '/LayoutObject/Bounds/@left')[1]::INTEGER as Bounds_Left,
        xml_extract_text(object_xml, '/LayoutObject/Bounds/@bottom')[1]::INTEGER as Bounds_Bottom,
        xml_extract_text(object_xml, '/LayoutObject/Bounds/@right')[1]::INTEGER as Bounds_Right,
        NULL::BIGINT as Parent_Object_ID,
        0 as Nesting_Level,
        t.z_order::INTEGER as Z_Order,
        -- Calculation Text Extraction (CDATA aus XML)
        xml_extract_text(object_xml, '/LayoutObject/Conditions/Hide/Calculation/Text')[1] as Hide_Calculation_Text,
        xml_extract_text(object_xml, '/LayoutObject/Tooltip/Calculation/Text')[1] as Tooltip_Calculation_Text,
        COALESCE(
            xml_extract_text(object_xml, '/LayoutObject/Button/Label/Calculation/Text')[1],
            xml_extract_text(object_xml, '/LayoutObject/GroupedButton/Label/Calculation/Text')[1],
            xml_extract_text(object_xml, '/LayoutObject/PopoverButton/Label/Calculation/Text')[1]
        ) as Label_Calculation_Text,
        array_to_string(
            xml_extract_text(object_xml, '/LayoutObject/ScriptTriggers/ScriptTrigger/ScriptReference/Calculation/Text'),
            E'\n'
        ) as ScriptTrigger_Parameter_Text,
        xml_extract_text(object_xml, '/LayoutObject/Text/StyledText/Data')[1] as Text_Content,
        object_xml
    FROM layout_parts
    CROSS JOIN LATERAL unnest(
        xml_extract_elements(part_xml, '/Part/ObjectList/LayoutObject')
    ) WITH ORDINALITY AS t(object_xml, z_order)
),
nested_objects AS (
    SELECT
        Layout_ID,
        Part_Type,
        Object_ID,
        Object_Type,
        Object_Name,
        Object_Kind,
        Object_Hash,
        Object_UUID,
        Bounds_Top,
        Bounds_Left,
        Bounds_Bottom,
        Bounds_Right,
        Parent_Object_ID,
        Nesting_Level,
        Z_Order,
        Hide_Calculation_Text,
        Tooltip_Calculation_Text,
        Label_Calculation_Text,
        ScriptTrigger_Parameter_Text,
        Text_Content,
        object_xml
    FROM root_objects

    UNION ALL

    SELECT
        parent.Layout_ID,
        parent.Part_Type,
        xml_extract_text(child_xml, '/LayoutObject/@id')[1]::BIGINT as Object_ID,
        xml_extract_text(child_xml, '/LayoutObject/@type')[1] as Object_Type,
        xml_extract_text(child_xml, '/LayoutObject/@name')[1] as Object_Name,
        xml_extract_text(child_xml, '/LayoutObject/@kind')[1]::INTEGER as Object_Kind,
        xml_extract_text(child_xml, '/LayoutObject/@hash')[1] as Object_Hash,
        xml_extract_text(child_xml, '/LayoutObject/UUID')[1] as Object_UUID,
        xml_extract_text(child_xml, '/LayoutObject/Bounds/@top')[1]::INTEGER as Bounds_Top,
        xml_extract_text(child_xml, '/LayoutObject/Bounds/@left')[1]::INTEGER as Bounds_Left,
        xml_extract_text(child_xml, '/LayoutObject/Bounds/@bottom')[1]::INTEGER as Bounds_Bottom,
        xml_extract_text(child_xml, '/LayoutObject/Bounds/@right')[1]::INTEGER as Bounds_Right,
        parent.Object_ID as Parent_Object_ID,
        parent.Nesting_Level + 1 as Nesting_Level,
        t.z_order::INTEGER as Z_Order,
        -- Calculation Text Extraction (CDATA aus XML)
        xml_extract_text(child_xml, '/LayoutObject/Conditions/Hide/Calculation/Text')[1] as Hide_Calculation_Text,
        xml_extract_text(child_xml, '/LayoutObject/Tooltip/Calculation/Text')[1] as Tooltip_Calculation_Text,
        COALESCE(
            xml_extract_text(child_xml, '/LayoutObject/Button/Label/Calculation/Text')[1],
            xml_extract_text(child_xml, '/LayoutObject/GroupedButton/Label/Calculation/Text')[1],
            xml_extract_text(child_xml, '/LayoutObject/PopoverButton/Label/Calculation/Text')[1]
        ) as Label_Calculation_Text,
        array_to_string(
            xml_extract_text(child_xml, '/LayoutObject/ScriptTriggers/ScriptTrigger/ScriptReference/Calculation/Text'),
            E'\n'
        ) as ScriptTrigger_Parameter_Text,
        xml_extract_text(child_xml, '/LayoutObject/Text/StyledText/Data')[1] as Text_Content,
        child_xml as object_xml
    FROM nested_objects parent
    CROSS JOIN LATERAL unnest(
        xml_extract_elements(parent.object_xml, '//ObjectList/LayoutObject')
    ) WITH ORDINALITY AS t(child_xml, z_order)
    WHERE parent.Object_Type IN (
        'Portal',
        'Group',
        'Tab Control',
        'Panel',
        'Container',
        'Button Bar',
        'Slide Control',
        'Grouped Button',
        'PopoverPanel',
        'Popover Button'
    )
)
INSERT INTO LayoutObjects
SELECT
    Layout_ID,
    Part_Type,
    Object_ID,
    Object_Type,
    Object_Name,
    Object_Kind,
    Object_Hash,
    Object_UUID,
    Bounds_Top,
    Bounds_Left,
    Bounds_Bottom,
    Bounds_Right,
    Parent_Object_ID,
    Nesting_Level,
    Z_Order,
    -- chr(127) -> chr(10): Preprocessing-Sentinel für CR zurück zu LF
    replace(Hide_Calculation_Text, chr(127), chr(10)) as Hide_Calculation_Text,
    replace(Tooltip_Calculation_Text, chr(127), chr(10)) as Tooltip_Calculation_Text,
    replace(Label_Calculation_Text, chr(127), chr(10)) as Label_Calculation_Text,
    replace(ScriptTrigger_Parameter_Text, chr(127), chr(10)) as ScriptTrigger_Parameter_Text,
    replace(Text_Content, chr(127), chr(10)) as Text_Content,
    object_xml::VARCHAR as Object_XML,
    fn.File_Name as File_Name
FROM nested_objects
CROSS JOIN filename_normalized fn
ON CONFLICT (Object_UUID, File_Name) DO UPDATE SET
    Layout_ID = EXCLUDED.Layout_ID,
    Part_Type = EXCLUDED.Part_Type,
    Object_ID = EXCLUDED.Object_ID,
    Object_Type = EXCLUDED.Object_Type,
    Object_Name = EXCLUDED.Object_Name,
    Object_Kind = EXCLUDED.Object_Kind,
    Object_Hash = EXCLUDED.Object_Hash,
    Bounds_Top = EXCLUDED.Bounds_Top,
    Bounds_Left = EXCLUDED.Bounds_Left,
    Bounds_Bottom = EXCLUDED.Bounds_Bottom,
    Bounds_Right = EXCLUDED.Bounds_Right,
    Parent_Object_ID = EXCLUDED.Parent_Object_ID,
    Nesting_Level = EXCLUDED.Nesting_Level,
    Z_Order = EXCLUDED.Z_Order,
    Hide_Calculation_Text = EXCLUDED.Hide_Calculation_Text,
    Tooltip_Calculation_Text = EXCLUDED.Tooltip_Calculation_Text,
    Label_Calculation_Text = EXCLUDED.Label_Calculation_Text,
    ScriptTrigger_Parameter_Text = EXCLUDED.ScriptTrigger_Parameter_Text,
    Text_Content = EXCLUDED.Text_Content,
    Object_XML = EXCLUDED.Object_XML;


-- ============================================
-- XMLLayoutReferences (ersetzt Python extract_xml_references.py)
-- ============================================
-- Extrahiert UUID-Referenzen aus LayoutObjects direkt per xml_extract_text().
CREATE TABLE IF NOT EXISTS XMLLayoutReferences (
    Object_UUID VARCHAR,
    Ref_Type VARCHAR,
    Ref_UUID VARCHAR,
    Ref_Name VARCHAR,
    File_Name VARCHAR
);

-- Bestehende Einträge für diese Datei entfernen (Idempotenz)
DELETE FROM XMLLayoutReferences WHERE File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
);

-- Feld-Referenzen: LayoutObject/Field/FieldReference/@UUID
WITH filename_normalized AS (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_layouts AS (
    SELECT unnest(xml_extract_elements(xml, '//LayoutCatalog/Layout')) as layout_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
layout_parts AS (
    SELECT unnest(xml_extract_elements(layout_xml, '/Layout/PartsList/Part')) as part_xml
    FROM raw_layouts
),
all_layout_objects AS (
    SELECT unnest(xml_extract_elements(part_xml, '//LayoutObject')) as object_xml
    FROM layout_parts
)
INSERT INTO XMLLayoutReferences
SELECT
    xml_extract_text(object_xml, '/LayoutObject/UUID')[1] as Object_UUID,
    'field' as Ref_Type,
    xml_extract_text(object_xml, '/LayoutObject/Field/FieldReference/@UUID')[1] as Ref_UUID,
    xml_extract_text(object_xml, '/LayoutObject/Field/FieldReference/@name')[1] as Ref_Name,
    fn.File_Name
FROM all_layout_objects CROSS JOIN filename_normalized fn
WHERE xml_extract_text(object_xml, '/LayoutObject/UUID')[1] IS NOT NULL
  AND xml_extract_text(object_xml, '/LayoutObject/Field/FieldReference/@UUID')[1] IS NOT NULL;

-- Script-Referenzen: //ScriptReference/@UUID (alle Nachfahren, via unnest)
WITH filename_normalized AS (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_layouts AS (
    SELECT unnest(xml_extract_elements(xml, '//LayoutCatalog/Layout')) as layout_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
layout_parts AS (
    SELECT unnest(xml_extract_elements(layout_xml, '/Layout/PartsList/Part')) as part_xml
    FROM raw_layouts
),
all_layout_objects AS (
    SELECT unnest(xml_extract_elements(part_xml, '//LayoutObject')) as object_xml
    FROM layout_parts
)
INSERT INTO XMLLayoutReferences
SELECT
    xml_extract_text(object_xml, '/LayoutObject/UUID')[1] as Object_UUID,
    'script' as Ref_Type,
    xml_extract_text(sr_xml, '/ScriptReference/@UUID')[1] as Ref_UUID,
    xml_extract_text(sr_xml, '/ScriptReference/@name')[1] as Ref_Name,
    fn.File_Name
FROM all_layout_objects CROSS JOIN filename_normalized fn
CROSS JOIN LATERAL unnest(
    xml_extract_elements(object_xml, '//ScriptReference')
) AS t(sr_xml)
WHERE xml_extract_text(object_xml, '/LayoutObject/UUID')[1] IS NOT NULL
  AND xml_extract_text(sr_xml, '/ScriptReference/@UUID')[1] IS NOT NULL;

-- ValueList-Referenzen: LayoutObject/Field/Display/ValueListReference/@UUID (NEU)
WITH filename_normalized AS (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_layouts AS (
    SELECT unnest(xml_extract_elements(xml, '//LayoutCatalog/Layout')) as layout_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
layout_parts AS (
    SELECT unnest(xml_extract_elements(layout_xml, '/Layout/PartsList/Part')) as part_xml
    FROM raw_layouts
),
all_layout_objects AS (
    SELECT unnest(xml_extract_elements(part_xml, '//LayoutObject')) as object_xml
    FROM layout_parts
)
INSERT INTO XMLLayoutReferences
SELECT
    xml_extract_text(object_xml, '/LayoutObject/UUID')[1] as Object_UUID,
    'valuelist' as Ref_Type,
    xml_extract_text(object_xml, '/LayoutObject/Field/Display/ValueListReference/@UUID')[1] as Ref_UUID,
    xml_extract_text(object_xml, '/LayoutObject/Field/Display/ValueListReference/@name')[1] as Ref_Name,
    fn.File_Name
FROM all_layout_objects CROSS JOIN filename_normalized fn
WHERE xml_extract_text(object_xml, '/LayoutObject/UUID')[1] IS NOT NULL
  AND xml_extract_text(object_xml, '/LayoutObject/Field/Display/ValueListReference/@UUID')[1] IS NOT NULL;

-- Portal → TableOccurrence: /LayoutObject/Portal/TableOccurrenceReference/@UUID (NEU)
WITH filename_normalized AS (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_layouts AS (
    SELECT unnest(xml_extract_elements(xml, '//LayoutCatalog/Layout')) as layout_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
layout_parts AS (
    SELECT unnest(xml_extract_elements(layout_xml, '/Layout/PartsList/Part')) as part_xml
    FROM raw_layouts
),
all_layout_objects AS (
    SELECT unnest(xml_extract_elements(part_xml, '//LayoutObject')) as object_xml
    FROM layout_parts
)
INSERT INTO XMLLayoutReferences
SELECT
    xml_extract_text(object_xml, '/LayoutObject/UUID')[1] as Object_UUID,
    'table_occurrence' as Ref_Type,
    xml_extract_text(object_xml, '/LayoutObject/Portal/TableOccurrenceReference/@UUID')[1] as Ref_UUID,
    xml_extract_text(object_xml, '/LayoutObject/Portal/TableOccurrenceReference/@name')[1] as Ref_Name,
    fn.File_Name
FROM all_layout_objects CROSS JOIN filename_normalized fn
WHERE xml_extract_text(object_xml, '/LayoutObject/@type')[1] = 'Portal'
  AND xml_extract_text(object_xml, '/LayoutObject/Portal/TableOccurrenceReference/@UUID')[1] IS NOT NULL;


-- AccountsCatalog
CREATE TABLE IF NOT EXISTS AccountsCatalog (
    Account_ID BIGINT,
    Account_Kind INTEGER,
    Account_Type VARCHAR,
    Is_Enabled BOOLEAN,
    Account_UUID VARCHAR,
    Description VARCHAR,
    Account_Name VARCHAR,
    Password_Encrypted VARCHAR,
    PrivilegeSet_ID BIGINT,
    PrivilegeSet_Name VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Account_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO AccountsCatalog
SELECT
    a.id AS Account_ID,
    a.kind AS Account_Kind,
    a.type AS Account_Type,
    a.enable AS Is_Enabled,
    a.UUID."#text" AS Account_UUID,
    a.Description AS Description,
    a.Authentication.AccountName AS Account_Name,
    a.Authentication.PasswordEncrypted AS Password_Encrypted,
    a.PrivilegeSetReference.id AS PrivilegeSet_ID,
    a.PrivilegeSetReference.name AS PrivilegeSet_Name,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='AccountsCatalog',
    record_element='ObjectList',
    max_depth=10,
    maximum_file_size=getvariable('max_filesize'),
    columns={
        'Account': 'STRUCT(
            id BIGINT,
            kind INTEGER,
            type VARCHAR,
            enable BOOLEAN,
            "UUID" STRUCT("#text" VARCHAR, modifications BIGINT, userName VARCHAR, accountName VARCHAR, timestamp VARCHAR),
            "Description" VARCHAR,
            "Authentication" STRUCT(
                "AccountName" VARCHAR,
                "PasswordEncrypted" VARCHAR
            ),
            "PrivilegeSetReference" STRUCT(
                id BIGINT,
                name VARCHAR
            )
        )[]'
    }
)
CROSS JOIN UNNEST(Account) AS t(a)
CROSS JOIN filename_normalized fn
WHERE a.id IS NOT NULL
ON CONFLICT (Account_UUID, File_Name) DO UPDATE SET
    Account_ID = EXCLUDED.Account_ID,
    Account_Kind = EXCLUDED.Account_Kind,
    Account_Type = EXCLUDED.Account_Type,
    Is_Enabled = EXCLUDED.Is_Enabled,
    Description = EXCLUDED.Description,
    Account_Name = EXCLUDED.Account_Name,
    Password_Encrypted = EXCLUDED.Password_Encrypted,
    PrivilegeSet_ID = EXCLUDED.PrivilegeSet_ID,
    PrivilegeSet_Name = EXCLUDED.PrivilegeSet_Name;


-- PrivilegeSetsCatalog
CREATE TABLE IF NOT EXISTS PrivilegeSetsCatalog (
    PrivilegeSet_ID BIGINT,
    PrivilegeSet_Name VARCHAR,
    PrivilegeSet_UUID VARCHAR,
    Description VARCHAR,
    Is_Default_Access BOOLEAN,
    Records_Create BOOLEAN,
    Records_Edit BOOLEAN,
    Records_Delete BOOLEAN,
    Records_View VARCHAR,
    Layouts_Create BOOLEAN,
    Layouts_Edit BOOLEAN,
    Layouts_Delete BOOLEAN,
    Layouts_View VARCHAR,
    Layouts_Custom BOOLEAN,
    ValueLists_Create BOOLEAN,
    ValueLists_Edit BOOLEAN,
    ValueLists_Delete BOOLEAN,
    ValueLists_View VARCHAR,
    Scripts_Create BOOLEAN,
    Scripts_Edit BOOLEAN,
    Scripts_Delete BOOLEAN,
    Scripts_View VARCHAR,
    Other_Value INTEGER,
    Allow_Print BOOLEAN,
    Allow_Export BOOLEAN,
    Manage_Database BOOLEAN,
    Manage_Custom_Menus BOOLEAN,
    Manage_Accounts BOOLEAN,
    Manage_Ext_Privs BOOLEAN,
    Allow_Override BOOLEAN,
    Allow_Open_Quickly BOOLEAN,
    Disconnect_Idle BOOLEAN,
    Commands VARCHAR,
    Password_Prohibit_Modification BOOLEAN,
    File_Name VARCHAR,
    PRIMARY KEY (PrivilegeSet_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
privilege_sets AS (
    SELECT
        unnest(xml_extract_elements(xml, '//PrivilegeSetsCatalog/ObjectList/PrivilegeSet')) as ps_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO PrivilegeSetsCatalog
SELECT
    xml_extract_text(ps_xml, '/PrivilegeSet/@id')[1]::BIGINT as PrivilegeSet_ID,
    xml_extract_text(ps_xml, '/PrivilegeSet/@name')[1] as PrivilegeSet_Name,
    xml_extract_text(ps_xml, '/PrivilegeSet/UUID')[1] as PrivilegeSet_UUID,
    xml_extract_text(ps_xml, '/PrivilegeSet/Description')[1] as Description,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/@default')[1] = 'True' as Is_Default_Access,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Records/@Create')[1] = 'True' as Records_Create,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Records/@Edit')[1] = 'True' as Records_Edit,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Records/@Delete')[1] = 'True' as Records_Delete,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Records/@View')[1] as Records_View,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Layouts/@Create')[1] = 'True' as Layouts_Create,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Layouts/@Edit')[1] = 'True' as Layouts_Edit,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Layouts/@Delete')[1] = 'True' as Layouts_Delete,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Layouts/@View')[1] as Layouts_View,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Layouts/@Custom')[1] = 'True' as Layouts_Custom,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/ValueLists/@Create')[1] = 'True' as ValueLists_Create,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/ValueLists/@Edit')[1] = 'True' as ValueLists_Edit,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/ValueLists/@Delete')[1] = 'True' as ValueLists_Delete,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/ValueLists/@View')[1] as ValueLists_View,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Scripts/@Create')[1] = 'True' as Scripts_Create,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Scripts/@Edit')[1] = 'True' as Scripts_Edit,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Scripts/@Delete')[1] = 'True' as Scripts_Delete,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Scripts/@View')[1] as Scripts_View,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@value')[1]::INTEGER as Other_Value,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@Print')[1] = 'True' as Allow_Print,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@Export')[1] = 'True' as Allow_Export,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@manageDatabase')[1] = 'True' as Manage_Database,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@manageCustomMenus')[1] = 'True' as Manage_Custom_Menus,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@manageAccounts')[1] = 'True' as Manage_Accounts,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@manageExtPrivs')[1] = 'True' as Manage_Ext_Privs,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@allowOverride')[1] = 'True' as Allow_Override,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@allowOpenQuickly')[1] = 'True' as Allow_Open_Quickly,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@disconnectIdle')[1] = 'True' as Disconnect_Idle,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@commands')[1] as Commands,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/Password/@prohibitModification')[1] = 'True' as Password_Prohibit_Modification,
    fn.File_Name as File_Name
FROM privilege_sets
CROSS JOIN filename_normalized fn
WHERE xml_extract_text(ps_xml, '/PrivilegeSet/@id')[1] IS NOT NULL
ON CONFLICT (PrivilegeSet_UUID, File_Name) DO UPDATE SET
    PrivilegeSet_ID = EXCLUDED.PrivilegeSet_ID,
    PrivilegeSet_Name = EXCLUDED.PrivilegeSet_Name,
    Description = EXCLUDED.Description,
    Is_Default_Access = EXCLUDED.Is_Default_Access,
    Records_Create = EXCLUDED.Records_Create,
    Records_Edit = EXCLUDED.Records_Edit,
    Records_Delete = EXCLUDED.Records_Delete,
    Records_View = EXCLUDED.Records_View,
    Layouts_Create = EXCLUDED.Layouts_Create,
    Layouts_Edit = EXCLUDED.Layouts_Edit,
    Layouts_Delete = EXCLUDED.Layouts_Delete,
    Layouts_View = EXCLUDED.Layouts_View,
    Layouts_Custom = EXCLUDED.Layouts_Custom,
    ValueLists_Create = EXCLUDED.ValueLists_Create,
    ValueLists_Edit = EXCLUDED.ValueLists_Edit,
    ValueLists_Delete = EXCLUDED.ValueLists_Delete,
    ValueLists_View = EXCLUDED.ValueLists_View,
    Scripts_Create = EXCLUDED.Scripts_Create,
    Scripts_Edit = EXCLUDED.Scripts_Edit,
    Scripts_Delete = EXCLUDED.Scripts_Delete,
    Scripts_View = EXCLUDED.Scripts_View,
    Other_Value = EXCLUDED.Other_Value,
    Allow_Print = EXCLUDED.Allow_Print,
    Allow_Export = EXCLUDED.Allow_Export,
    Manage_Database = EXCLUDED.Manage_Database,
    Manage_Custom_Menus = EXCLUDED.Manage_Custom_Menus,
    Manage_Accounts = EXCLUDED.Manage_Accounts,
    Manage_Ext_Privs = EXCLUDED.Manage_Ext_Privs,
    Allow_Override = EXCLUDED.Allow_Override,
    Allow_Open_Quickly = EXCLUDED.Allow_Open_Quickly,
    Disconnect_Idle = EXCLUDED.Disconnect_Idle,
    Commands = EXCLUDED.Commands,
    Password_Prohibit_Modification = EXCLUDED.Password_Prohibit_Modification;


-- ========================================
-- DDR_INFO Integration (FileMaker 21+)
--
-- HINWEIS: Diese Tabellen werden immer erstellt, bleiben aber leer,
-- wenn die XML-Datei kein Has_DDR_INFO="True" Attribut hat.
-- Prüfe XMLMetadata.Has_DDR_INFO um zu sehen, ob DDR-Info verfügbar ist.
-- ========================================

-- DDR_ScriptSteps: Lesbare Script-Schritte aus DDR_INFO
CREATE TABLE IF NOT EXISTS DDR_ScriptSteps (
    Step_UUID VARCHAR,
    Step_Hash VARCHAR,
    Step_Text VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Step_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
ddr_script_raw AS (
    SELECT
        unnest(xml_extract_elements(xml, '//DDR_INFO/Script/ObjectList/*')) as step_elem
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO DDR_ScriptSteps
SELECT
    regexp_extract(
        step_elem::VARCHAR,
        '<_([0-9A-F-]+)',
        1
    ) as Step_UUID,
    xml_extract_text(step_elem, '//*/@hash')[1] as Step_Hash,
    replace(xml_extract_text(step_elem, '//text()')[1], chr(127), chr(10)) as Step_Text,
    fn.File_Name as File_Name
FROM ddr_script_raw
CROSS JOIN filename_normalized fn
WHERE xml_extract_text(step_elem, '//*/@datatype')[1] = 'StepText'
ON CONFLICT (Step_UUID, File_Name) DO UPDATE SET
    Step_Hash = EXCLUDED.Step_Hash,
    Step_Text = EXCLUDED.Step_Text;


-- DDR_Calculations: Formel-Chunks für Abhängigkeitsanalyse
CREATE TABLE IF NOT EXISTS DDR_Calculations (
    Calc_UUID VARCHAR,
    Calc_Hash VARCHAR,
    Chunk_Index BIGINT,
    Chunk_Type VARCHAR,
    Chunk_Content VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Calc_UUID, Chunk_Index, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
ddr_calc_raw AS (
    SELECT
        unnest(xml_extract_elements(xml, '//DDR_INFO/Calculation/ObjectList/*')) as calc_elem
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
-- Chunk-Index in XML-Dokumentreihenfolge (PRD prd_universal_function_links.md §4):
-- Zwei parallele unnest()-Aufrufe iterieren synchron pro Zeile. Die Chunk-Liste
-- und ein begleitendes generate_series mit derselben Länge erzeugen einen
-- deterministischen, lesegerechten Chunk_Index. Vorgängerlösung mit
-- ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) war nicht-deterministisch.
calc_with_chunk_lists AS (
    SELECT
        regexp_extract(
            calc_elem::VARCHAR,
            '<_([0-9A-F-]+)',
            1
        ) as Calc_UUID,
        xml_extract_text(calc_elem, '//*/@hash')[1] as Calc_Hash,
        xml_extract_elements(calc_elem, '//ChunkList/Chunk') as chunks
    FROM ddr_calc_raw
    WHERE xml_extract_text(calc_elem, '//*/@datatype')[1] = 'ChunkList'
),
calc_with_chunks AS (
    SELECT
        Calc_UUID,
        Calc_Hash,
        unnest(chunks) as chunk_xml,
        unnest(generate_series(1, len(chunks))) as chunk_index
    FROM calc_with_chunk_lists
)
INSERT INTO DDR_Calculations
SELECT
    Calc_UUID,
    Calc_Hash,
    chunk_index as Chunk_Index,
    xml_extract_text(chunk_xml, '/Chunk/@type')[1] as Chunk_Type,
    COALESCE(
        xml_extract_text(chunk_xml, 'text()')[1],
        chunk_xml::VARCHAR
    ) as Chunk_Content,
    fn.File_Name as File_Name
FROM calc_with_chunks
CROSS JOIN filename_normalized fn
ON CONFLICT (Calc_UUID, Chunk_Index, File_Name) DO UPDATE SET
    Calc_Hash = EXCLUDED.Calc_Hash,
    Chunk_Type = EXCLUDED.Chunk_Type,
    Chunk_Content = EXCLUDED.Chunk_Content;


-- ============================================
-- MBS_SubnameMap (PRD prd_rest_api_plugin_docs_subfunction.md §3.5 Variante B)
-- ============================================
-- Pro `MBS`-PluginFunctionRef-Chunk wird der fachliche MBS-Funktionsname (erstes
-- Argument, z.B. "List.AddPrefix") aus den NoRef-Chunks derselben Calculation
-- ermittelt. Seit PRD prd_universal_function_links.md §4 steht Chunk_Index in
-- XML-Dokumentreihenfolge — die Pairing-Heuristik nutzt nur die relative
-- Reihenfolge pro Liste:
--   (a) alle MBS-PluginFunctionRef-Chunks und
--   (b) alle NoRef-Chunks mit Pattern `( "..."` (= MBS-Argumentliste)
-- werden nach Chunk_Index sortiert und 1:1 per ROW_NUMBER gemappt.
-- Bei dynamischem ersten Argument (`MBS( $name ; … )`) liefert die NoRef-Liste
-- weniger Treffer als die MBS-Liste — dann bleibt SubName NULL (kein subFunction
-- im Tokens-Output, siehe PRD §3.4).

CREATE TABLE IF NOT EXISTS MBS_SubnameMap (
    Calc_UUID VARCHAR,
    File_Name VARCHAR,
    Plugin_Chunk_Index BIGINT,    -- Chunk_Index des PluginFunctionRef-Chunks
    SubName VARCHAR,               -- fachlicher MBS-Funktionsname (z.B. "List.AddPrefix")
    PRIMARY KEY (Calc_UUID, File_Name, Plugin_Chunk_Index)
);

-- Idempotenz: bestehende Einträge der aktuellen Datei entfernen
DELETE FROM MBS_SubnameMap WHERE File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
);

INSERT INTO MBS_SubnameMap
WITH plugin_refs AS (
    SELECT d.Calc_UUID, d.File_Name, d.Chunk_Index,
        ROW_NUMBER() OVER (PARTITION BY d.Calc_UUID, d.File_Name ORDER BY d.Chunk_Index) AS rn
    FROM DDR_Calculations d
    WHERE d.Chunk_Type = 'PluginFunctionRef'
      AND regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) = 'MBS'
      AND d.File_Name = (
        SELECT regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
        ) FROM read_xml_objects(getvariable('fm_xml'),
            maximum_file_size=getvariable('max_filesize'))
      )
),
subname_chunks AS (
    SELECT d.Calc_UUID, d.File_Name, d.Chunk_Index,
        regexp_extract(d.Chunk_Content, '\(\s*"([^"]+)"', 1) AS SubName,
        ROW_NUMBER() OVER (PARTITION BY d.Calc_UUID, d.File_Name ORDER BY d.Chunk_Index) AS rn
    FROM DDR_Calculations d
    WHERE d.Chunk_Type = 'NoRef'
      AND regexp_matches(d.Chunk_Content, '\(\s*"[^"]+"')
      AND d.File_Name = (
        SELECT regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
        ) FROM read_xml_objects(getvariable('fm_xml'),
            maximum_file_size=getvariable('max_filesize'))
      )
)
SELECT pr.Calc_UUID, pr.File_Name, pr.Chunk_Index, sc.SubName
FROM plugin_refs pr
LEFT JOIN subname_chunks sc
  ON pr.Calc_UUID = sc.Calc_UUID
 AND pr.File_Name = sc.File_Name
 AND pr.rn = sc.rn;


-- ============================================
-- GetSubparameterMap (PRD prd_universal_function_links.md §7)
-- ============================================
-- Get(<SubParameter>) ist eine FileMaker-Container-Funktion: pro Sub-Parameter
-- liefert sie einen anderen Wert. Im DDR steht der Sub-Parameter als eigener
-- FunctionRef-Chunk innerhalb von Get( ... ) — Pattern (nach Chunk-Reorder
-- gemäß §4 immer in dieser Reihenfolge):
--   Chunk N:   FunctionRef = 'Get'
--   Chunk N+1: NoRef       = '(' (mit optionalem Whitespace)
--   Chunk N+2: FunctionRef = '<SubParameter>'  (z.B. 'LayoutName')
--   Chunk N+3: NoRef       = ')...'
-- Bei dynamischen Aufrufen (Get($name) oder Get(Abs(...))) bleibt SubParameter
-- NULL (Chunk N+2 ist VariableReference, FieldRef oder eine andere Funktion
-- die in der fm_reference NICHT als is_get_function markiert ist).
-- Die Get-Familie ist hier auf 'Get' beschränkt; lokalisierte Tokens (Holen,
-- Recibir, …) erscheinen im DDR praktisch nicht, weil FM die FunctionRefs auf
-- den kanonischen Namen normalisiert. Bei Bedarf erweiterbar.

CREATE TABLE IF NOT EXISTS GetSubparameterMap (
    Calc_UUID VARCHAR NOT NULL,
    File_Name VARCHAR NOT NULL,
    Get_Chunk_Index BIGINT NOT NULL,   -- Index des Get-FunctionRef-Chunks
    SubParameter VARCHAR,               -- z.B. 'ApplicationVersion', NULL bei dynamisch
    PRIMARY KEY (Calc_UUID, File_Name, Get_Chunk_Index)
);

-- Idempotenz: bestehende Einträge der aktuellen Datei entfernen
DELETE FROM GetSubparameterMap WHERE File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
);

INSERT INTO GetSubparameterMap
WITH file_chunks AS (
    SELECT d.*
    FROM DDR_Calculations d
    WHERE d.File_Name = (
        SELECT regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
        ) FROM read_xml_objects(getvariable('fm_xml'),
            maximum_file_size=getvariable('max_filesize'))
    )
),
chunks_with_lead AS (
    SELECT
        Calc_UUID, File_Name, Chunk_Index, Chunk_Type, Chunk_Content,
        LEAD(Chunk_Type, 1) OVER w AS Next_Type,
        LEAD(Chunk_Type, 2) OVER w AS Next2_Type,
        LEAD(Chunk_Content, 2) OVER w AS Next2_Content
    FROM file_chunks
    WINDOW w AS (PARTITION BY Calc_UUID, File_Name ORDER BY Chunk_Index)
)
SELECT
    Calc_UUID,
    File_Name,
    Chunk_Index AS Get_Chunk_Index,
    CASE
        WHEN Next_Type = 'NoRef' AND Next2_Type = 'FunctionRef'
            THEN regexp_extract(Next2_Content, '>([^<]+)</Chunk>', 1)
        ELSE NULL
    END AS SubParameter
FROM chunks_with_lead
WHERE Chunk_Type = 'FunctionRef'
  AND regexp_extract(Chunk_Content, '>([^<]+)</Chunk>', 1) = 'Get';


-- ============================================
-- XMLCalcReferences (PRD Erweiterte Referenzen v1)
-- ============================================
-- Resolved DDR-Refs (FieldRef + CustomFunctionRef) aus allen Calculation-Quellen:
--   - FieldsForTables (Calculated, AutoEnter-Calc) via DDR_Hash / AE_Calc_Hash
--   - CustomFunctionsCatalog via DDR_Hash
--   - StepsForScripts via DDRREF-Hashes im Parameters_XML
--   - LayoutObjects via DDRREF-Hashes im Object_XML
-- Plugin-Funktionen landen in PluginFunctionUsages (separate Tabelle, da kein
-- ObjectCatalog-Eintrag vorhanden).
CREATE TABLE IF NOT EXISTS XMLCalcReferences (
    Source_UUID VARCHAR,         -- Script_UUID, Field_UUID, CF_UUID oder LayoutObject_UUID
    Source_Type VARCHAR,         -- 'Script', 'Field', 'CustomFunction', 'LayoutObject'
    Source_Subkey VARCHAR,       -- Step_Index (Steps), NULL (Field/CF/LayoutObject)
    Subrole VARCHAR,             -- 'Hide','Tooltip','Condition_1','action','1','2',NULL
    Calc_Hash VARCHAR,
    Ref_Type VARCHAR,            -- 'field' | 'customfunction' | 'pluginfunction' | 'variable'
    Ref_UUID VARCHAR,            -- Field-UUID (NULL bei CF/Plugin/Variable)
    Ref_Name VARCHAR,            -- Field-/CF-/Plugin-Name oder Variable-Name (mit Präfix)
    File_Name VARCHAR,
    TO_Name VARCHAR,             -- TO-Name aus <TableOccurrenceReference> (NULL bei CF/Plugin/Var)
    TO_UUID VARCHAR,             -- TO-UUID analog
    -- v2.0 Erweiterungen (PRD prd_rest_api_token_extended_infos.md §4.4):
    Variable_Scope VARCHAR,      -- nur Ref_Type='variable': 'local'|'global'|'superglobal'|'let_local'
    Usage_Type VARCHAR,          -- nur Ref_Type='variable': 'read' (Calc-Chunk-Refs sind immer Lesungen)
    -- v2.1 Erweiterung (PRD prd_rest_api_plugin_docs_subfunction.md §3.5 Variante B):
    Ref_SubName VARCHAR          -- nur Ref_Type='pluginfunction' bei Container-Plugins
                                 -- (heute: MBS) — fachlicher Funktionsname aus dem
                                 -- ersten quoted String des Folge-NoRef-Chunks.
);

-- Additive Migration: Spalten für Bestands-DBs nachziehen. ADD COLUMN IF NOT EXISTS
-- ist idempotent. Reihenfolge identisch zu CREATE TABLE — positionsbasierte INSERTs
-- bleiben konsistent über beide Schema-Pfade.
ALTER TABLE XMLCalcReferences ADD COLUMN IF NOT EXISTS TO_Name VARCHAR;
ALTER TABLE XMLCalcReferences ADD COLUMN IF NOT EXISTS TO_UUID VARCHAR;
ALTER TABLE XMLCalcReferences ADD COLUMN IF NOT EXISTS Variable_Scope VARCHAR;
ALTER TABLE XMLCalcReferences ADD COLUMN IF NOT EXISTS Usage_Type VARCHAR;
ALTER TABLE XMLCalcReferences ADD COLUMN IF NOT EXISTS Ref_SubName VARCHAR;

CREATE TABLE IF NOT EXISTS PluginFunctionUsages (
    Source_UUID VARCHAR,
    Source_Type VARCHAR,
    Source_Subkey VARCHAR,       -- Step_Index oder NULL
    Subrole VARCHAR,
    Plugin_Function_Name VARCHAR,
    Calc_Hash VARCHAR,
    File_Name VARCHAR,
    -- PRD prd_universal_function_links.md §6.3: Positionsbezogene Spalten,
    -- damit (Source, Calc_UUID, Plugin_Chunk_Index) eindeutig auf einen SubName
    -- in MBS_SubnameMap mappt. Calc_Hash-Joins explodieren wegen Hash-Dedup
    -- (1 Hash → bis zu 58k Calc_UUIDs); diese beiden Spalten lösen das.
    Calc_UUID VARCHAR,
    Plugin_Chunk_Index BIGINT
);

-- Additive Migration für Bestands-DBs (Reihenfolge identisch zum CREATE TABLE).
ALTER TABLE PluginFunctionUsages ADD COLUMN IF NOT EXISTS Calc_UUID VARCHAR;
ALTER TABLE PluginFunctionUsages ADD COLUMN IF NOT EXISTS Plugin_Chunk_Index BIGINT;

-- Idempotenz: bestehende Einträge der aktuellen Datei entfernen
DELETE FROM XMLCalcReferences WHERE File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
);

DELETE FROM PluginFunctionUsages WHERE File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
);

-- ============================================
-- A.2 — Refs aus Calculated Fields & AutoEnter-Calc (direkter DDR_Hash-Match)
-- ============================================

-- A.2.1 FieldRef in Calculated Fields (DDR_Hash)
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'field',
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*UUID="([^"]+)"', 1),
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*name="([^"]+)"', 1),
    d.File_Name,
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*name="([^"]+)"', 1), ''),
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*UUID="([^"]+)"', 1), ''),
    NULL, NULL,  -- Variable_Scope, Usage_Type (nur für Ref_Type='variable')
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.DDR_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
WHERE d.Chunk_Type = 'FieldRef'
  AND f.DDR_Hash IS NOT NULL
  AND f.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- A.2.2 CustomFunctionRef in Calculated Fields (DDR_Hash)
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'customfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    NULL, NULL,  -- Variable_Scope, Usage_Type
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.DDR_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
WHERE d.Chunk_Type = 'CustomFunctionRef'
  AND f.DDR_Hash IS NOT NULL
  AND f.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- A.2.3 PluginFunctionRef in Calculated Fields → PluginFunctionUsages
INSERT INTO PluginFunctionUsages
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.Calc_Hash,
    d.File_Name,
    d.Calc_UUID,
    d.Chunk_Index
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.DDR_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
WHERE d.Chunk_Type = 'PluginFunctionRef'
  AND f.DDR_Hash IS NOT NULL
  AND f.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- A.2.4 FieldRef in AutoEnter-Calc (AE_Calc_Hash)
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'field',
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*UUID="([^"]+)"', 1),
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*name="([^"]+)"', 1),
    d.File_Name,
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*name="([^"]+)"', 1), ''),
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*UUID="([^"]+)"', 1), ''),
    NULL, NULL,  -- Variable_Scope, Usage_Type (nur für Ref_Type='variable')
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.AE_Calc_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
WHERE d.Chunk_Type = 'FieldRef'
  AND f.AE_Calc_Hash IS NOT NULL
  AND f.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- A.2.5 CustomFunctionRef in AutoEnter-Calc (AE_Calc_Hash)
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'customfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    NULL, NULL,  -- Variable_Scope, Usage_Type
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.AE_Calc_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
WHERE d.Chunk_Type = 'CustomFunctionRef'
  AND f.AE_Calc_Hash IS NOT NULL
  AND f.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- A.2.6 PluginFunctionRef in AutoEnter-Calc → PluginFunctionUsages
INSERT INTO PluginFunctionUsages
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.Calc_Hash,
    d.File_Name,
    d.Calc_UUID,
    d.Chunk_Index
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.AE_Calc_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
WHERE d.Chunk_Type = 'PluginFunctionRef'
  AND f.AE_Calc_Hash IS NOT NULL
  AND f.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- ============================================
-- A.3 — Refs aus CustomFunctions (direkter DDR_Hash-Match)
-- ============================================

-- A.3.1 FieldRef in CustomFunctions
INSERT INTO XMLCalcReferences
SELECT
    cf.CF_UUID, 'CustomFunction', NULL, NULL,
    d.Calc_Hash, 'field',
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*UUID="([^"]+)"', 1),
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*name="([^"]+)"', 1),
    d.File_Name,
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*name="([^"]+)"', 1), ''),
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*UUID="([^"]+)"', 1), ''),
    NULL, NULL,  -- Variable_Scope, Usage_Type (nur für Ref_Type='variable')
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM CustomFunctionsCatalog cf
JOIN DDR_Calculations d ON cf.DDR_Hash = d.Calc_Hash AND cf.File_Name = d.File_Name
WHERE d.Chunk_Type = 'FieldRef'
  AND cf.DDR_Hash IS NOT NULL
  AND cf.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- A.3.2 CustomFunctionRef in CustomFunctions (CF→CF Aufrufe)
INSERT INTO XMLCalcReferences
SELECT
    cf.CF_UUID, 'CustomFunction', NULL, NULL,
    d.Calc_Hash, 'customfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    NULL, NULL,  -- Variable_Scope, Usage_Type
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM CustomFunctionsCatalog cf
JOIN DDR_Calculations d ON cf.DDR_Hash = d.Calc_Hash AND cf.File_Name = d.File_Name
WHERE d.Chunk_Type = 'CustomFunctionRef'
  AND cf.DDR_Hash IS NOT NULL
  AND cf.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- A.3.3 PluginFunctionRef in CustomFunctions → PluginFunctionUsages
INSERT INTO PluginFunctionUsages
SELECT
    cf.CF_UUID, 'CustomFunction', NULL, NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.Calc_Hash,
    d.File_Name,
    d.Calc_UUID,
    d.Chunk_Index
FROM CustomFunctionsCatalog cf
JOIN DDR_Calculations d ON cf.DDR_Hash = d.Calc_Hash AND cf.File_Name = d.File_Name
WHERE d.Chunk_Type = 'PluginFunctionRef'
  AND cf.DDR_Hash IS NOT NULL
  AND cf.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- ============================================
-- A.4 — Refs aus Script-Steps (DDRREF-Hashes via Regex)
-- ============================================
-- DDRREF-Pattern: kind="ChunkList" hash="<HEX>" ...>_<UUID>_<SLOT></DDRREF>
-- Slot-Index ist FileMaker-spezifisch (Step-Typ-abhängig). Wir speichern ihn
-- als Subrole, ohne semantische Auflösung.

-- A.4.1 FieldRef in Script-Steps
WITH step_hashes AS (
    SELECT
        s.Script_UUID,
        s.Step_Index::VARCHAR AS Step_Index,
        s.File_Name,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM StepsForScripts s
    WHERE s.Parameters_XML LIKE '%DDRREF%'
      AND s.File_Name = (
        SELECT regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
        ) FROM read_xml_objects(getvariable('fm_xml'),
            maximum_file_size=getvariable('max_filesize'))
      )
)
INSERT INTO XMLCalcReferences
SELECT
    sh.Script_UUID, 'Script', sh.Step_Index, sh.Subrole,
    sh.Calc_Hash, 'field',
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*UUID="([^"]+)"', 1),
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*name="([^"]+)"', 1),
    sh.File_Name,
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*name="([^"]+)"', 1), ''),
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*UUID="([^"]+)"', 1), ''),
    NULL, NULL,  -- Variable_Scope, Usage_Type (nur für Ref_Type='variable')
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM step_hashes sh
JOIN DDR_Calculations d
  ON sh.Calc_Hash = d.Calc_Hash
 AND sh.File_Name = d.File_Name
WHERE d.Chunk_Type = 'FieldRef';

-- A.4.2 CustomFunctionRef in Script-Steps
WITH step_hashes AS (
    SELECT
        s.Script_UUID,
        s.Step_Index::VARCHAR AS Step_Index,
        s.File_Name,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM StepsForScripts s
    WHERE s.Parameters_XML LIKE '%DDRREF%'
      AND s.File_Name = (
        SELECT regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
        ) FROM read_xml_objects(getvariable('fm_xml'),
            maximum_file_size=getvariable('max_filesize'))
      )
)
INSERT INTO XMLCalcReferences
SELECT
    sh.Script_UUID, 'Script', sh.Step_Index, sh.Subrole,
    sh.Calc_Hash, 'customfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    sh.File_Name,
    NULL, NULL,
    NULL, NULL,  -- Variable_Scope, Usage_Type
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM step_hashes sh
JOIN DDR_Calculations d
  ON sh.Calc_Hash = d.Calc_Hash
 AND sh.File_Name = d.File_Name
WHERE d.Chunk_Type = 'CustomFunctionRef';

-- A.4.3 PluginFunctionRef in Script-Steps → PluginFunctionUsages
WITH step_hashes AS (
    SELECT
        s.Script_UUID,
        s.Step_Index::VARCHAR AS Step_Index,
        s.File_Name,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM StepsForScripts s
    WHERE s.Parameters_XML LIKE '%DDRREF%'
      AND s.File_Name = (
        SELECT regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
        ) FROM read_xml_objects(getvariable('fm_xml'),
            maximum_file_size=getvariable('max_filesize'))
      )
)
INSERT INTO PluginFunctionUsages
SELECT
    sh.Script_UUID, 'Script', sh.Step_Index, sh.Subrole,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    sh.Calc_Hash,
    sh.File_Name,
    d.Calc_UUID,
    d.Chunk_Index
FROM step_hashes sh
JOIN DDR_Calculations d
  ON sh.Calc_Hash = d.Calc_Hash
 AND sh.File_Name = d.File_Name
WHERE d.Chunk_Type = 'PluginFunctionRef';

-- ============================================
-- A.5 — Refs aus LayoutObjects (DDRREF-Hashes via Regex)
-- ============================================
-- Subrole: semantischer Suffix aus dem DDRREF (z.B. Hide, Tooltip, Condition_1,
-- action, ScriptTrigger_*, Label, TabPanel, Portal, Placeholder, WebViewer).

-- A.5.1 FieldRef in LayoutObjects
WITH layout_obj_hashes AS (
    SELECT
        lo.Object_UUID,
        lo.File_Name,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM LayoutObjects lo
    WHERE lo.Object_XML LIKE '%DDRREF%'
      AND lo.File_Name = (
        SELECT regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
        ) FROM read_xml_objects(getvariable('fm_xml'),
            maximum_file_size=getvariable('max_filesize'))
      )
)
INSERT INTO XMLCalcReferences
SELECT
    loh.Object_UUID, 'LayoutObject', NULL, loh.Subrole,
    loh.Calc_Hash, 'field',
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*UUID="([^"]+)"', 1),
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*name="([^"]+)"', 1),
    loh.File_Name,
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*name="([^"]+)"', 1), ''),
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*UUID="([^"]+)"', 1), ''),
    NULL, NULL,  -- Variable_Scope, Usage_Type (nur für Ref_Type='variable')
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM layout_obj_hashes loh
JOIN DDR_Calculations d
  ON loh.Calc_Hash = d.Calc_Hash
 AND loh.File_Name = d.File_Name
WHERE d.Chunk_Type = 'FieldRef';

-- A.5.2 CustomFunctionRef in LayoutObjects
WITH layout_obj_hashes AS (
    SELECT
        lo.Object_UUID,
        lo.File_Name,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM LayoutObjects lo
    WHERE lo.Object_XML LIKE '%DDRREF%'
      AND lo.File_Name = (
        SELECT regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
        ) FROM read_xml_objects(getvariable('fm_xml'),
            maximum_file_size=getvariable('max_filesize'))
      )
)
INSERT INTO XMLCalcReferences
SELECT
    loh.Object_UUID, 'LayoutObject', NULL, loh.Subrole,
    loh.Calc_Hash, 'customfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    loh.File_Name,
    NULL, NULL,
    NULL, NULL,  -- Variable_Scope, Usage_Type
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM layout_obj_hashes loh
JOIN DDR_Calculations d
  ON loh.Calc_Hash = d.Calc_Hash
 AND loh.File_Name = d.File_Name
WHERE d.Chunk_Type = 'CustomFunctionRef';

-- A.5.3 PluginFunctionRef in LayoutObjects → PluginFunctionUsages
WITH layout_obj_hashes AS (
    SELECT
        lo.Object_UUID,
        lo.File_Name,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM LayoutObjects lo
    WHERE lo.Object_XML LIKE '%DDRREF%'
      AND lo.File_Name = (
        SELECT regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
        ) FROM read_xml_objects(getvariable('fm_xml'),
            maximum_file_size=getvariable('max_filesize'))
      )
)
INSERT INTO PluginFunctionUsages
SELECT
    loh.Object_UUID, 'LayoutObject', NULL, loh.Subrole,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    loh.Calc_Hash,
    loh.File_Name,
    d.Calc_UUID,
    d.Chunk_Index
FROM layout_obj_hashes loh
JOIN DDR_Calculations d
  ON loh.Calc_Hash = d.Calc_Hash
 AND loh.File_Name = d.File_Name
WHERE d.Chunk_Type = 'PluginFunctionRef';


-- ============================================
-- A.6 — Plugin- und Variable-Refs in XMLCalcReferences (PRD §5.3)
-- ============================================
-- 5 Quellen × 2 neue Ref-Typen = 10 INSERT-Blöcke.
-- PluginFunction-Refs sind hier zusätzlich zu PluginFunctionUsages enthalten,
-- damit der Tokens-Output sie als Refs ausliefern kann.
-- Variable-Refs (immer 'read') ergänzen die Set-Variable-Definitionen aus
-- XMLStepReferences (Usage_Type='set') zur bidirektionalen Cross-Step-Navigation.

-- A.6.1 PluginFunctionRef in Calculated Fields
-- Ref_SubName aus MBS_SubnameMap (NULL für Nicht-Container-Plugins).
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'pluginfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    NULL, NULL,
    m.SubName  -- Ref_SubName
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.DDR_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
LEFT JOIN MBS_SubnameMap m
       ON m.Calc_UUID = d.Calc_UUID
      AND m.File_Name = d.File_Name
      AND m.Plugin_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'PluginFunctionRef'
  AND f.DDR_Hash IS NOT NULL
  AND f.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- A.6.2 VariableReference in Calculated Fields
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'variable',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    CASE
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$$%' THEN 'superglobal'
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$%'  THEN 'global'
        ELSE 'local'
    END,
    'read',
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.DDR_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
WHERE d.Chunk_Type = 'VariableReference'
  AND f.DDR_Hash IS NOT NULL
  AND f.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- A.6.3 PluginFunctionRef in AutoEnter-Calc
-- Ref_SubName aus MBS_SubnameMap (NULL für Nicht-Container-Plugins).
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'pluginfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    NULL, NULL,
    m.SubName  -- Ref_SubName
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.AE_Calc_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
LEFT JOIN MBS_SubnameMap m
       ON m.Calc_UUID = d.Calc_UUID
      AND m.File_Name = d.File_Name
      AND m.Plugin_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'PluginFunctionRef'
  AND f.AE_Calc_Hash IS NOT NULL
  AND f.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- A.6.4 VariableReference in AutoEnter-Calc
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'variable',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    CASE
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$$%' THEN 'superglobal'
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$%'  THEN 'global'
        ELSE 'local'
    END,
    'read',
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.AE_Calc_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
WHERE d.Chunk_Type = 'VariableReference'
  AND f.AE_Calc_Hash IS NOT NULL
  AND f.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- A.6.5 PluginFunctionRef in CustomFunctions
-- Ref_SubName aus MBS_SubnameMap (NULL für Nicht-Container-Plugins).
INSERT INTO XMLCalcReferences
SELECT
    cf.CF_UUID, 'CustomFunction', NULL, NULL,
    d.Calc_Hash, 'pluginfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    NULL, NULL,
    m.SubName  -- Ref_SubName
FROM CustomFunctionsCatalog cf
JOIN DDR_Calculations d ON cf.DDR_Hash = d.Calc_Hash AND cf.File_Name = d.File_Name
LEFT JOIN MBS_SubnameMap m
       ON m.Calc_UUID = d.Calc_UUID
      AND m.File_Name = d.File_Name
      AND m.Plugin_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'PluginFunctionRef'
  AND cf.DDR_Hash IS NOT NULL
  AND cf.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- A.6.6 VariableReference in CustomFunctions
INSERT INTO XMLCalcReferences
SELECT
    cf.CF_UUID, 'CustomFunction', NULL, NULL,
    d.Calc_Hash, 'variable',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    CASE
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$$%' THEN 'superglobal'
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$%'  THEN 'global'
        ELSE 'local'
    END,
    'read',
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM CustomFunctionsCatalog cf
JOIN DDR_Calculations d ON cf.DDR_Hash = d.Calc_Hash AND cf.File_Name = d.File_Name
WHERE d.Chunk_Type = 'VariableReference'
  AND cf.DDR_Hash IS NOT NULL
  AND cf.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- A.6.7 PluginFunctionRef in Script-Steps
-- Ref_SubName aus MBS_SubnameMap (NULL für Nicht-Container-Plugins).
WITH step_hashes AS (
    SELECT
        s.Script_UUID,
        s.Step_Index::VARCHAR AS Step_Index,
        s.File_Name,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM StepsForScripts s
    WHERE s.Parameters_XML LIKE '%DDRREF%'
      AND s.File_Name = (
        SELECT regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
        ) FROM read_xml_objects(getvariable('fm_xml'),
            maximum_file_size=getvariable('max_filesize'))
      )
)
INSERT INTO XMLCalcReferences
SELECT
    sh.Script_UUID, 'Script', sh.Step_Index, sh.Subrole,
    sh.Calc_Hash, 'pluginfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    sh.File_Name,
    NULL, NULL,
    NULL, NULL,
    m.SubName  -- Ref_SubName
FROM step_hashes sh
JOIN DDR_Calculations d
  ON sh.Calc_Hash = d.Calc_Hash
 AND sh.File_Name = d.File_Name
LEFT JOIN MBS_SubnameMap m
       ON m.Calc_UUID = d.Calc_UUID
      AND m.File_Name = d.File_Name
      AND m.Plugin_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'PluginFunctionRef';

-- A.6.8 VariableReference in Script-Steps
WITH step_hashes AS (
    SELECT
        s.Script_UUID,
        s.Step_Index::VARCHAR AS Step_Index,
        s.File_Name,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM StepsForScripts s
    WHERE s.Parameters_XML LIKE '%DDRREF%'
      AND s.File_Name = (
        SELECT regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
        ) FROM read_xml_objects(getvariable('fm_xml'),
            maximum_file_size=getvariable('max_filesize'))
      )
)
INSERT INTO XMLCalcReferences
SELECT
    sh.Script_UUID, 'Script', sh.Step_Index, sh.Subrole,
    sh.Calc_Hash, 'variable',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    sh.File_Name,
    NULL, NULL,
    CASE
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$$%' THEN 'superglobal'
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$%'  THEN 'global'
        ELSE 'local'
    END,
    'read',
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM step_hashes sh
JOIN DDR_Calculations d
  ON sh.Calc_Hash = d.Calc_Hash
 AND sh.File_Name = d.File_Name
WHERE d.Chunk_Type = 'VariableReference';

-- A.6.9 PluginFunctionRef in LayoutObjects
-- Ref_SubName aus MBS_SubnameMap (NULL für Nicht-Container-Plugins).
WITH layout_obj_hashes AS (
    SELECT
        lo.Object_UUID,
        lo.File_Name,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM LayoutObjects lo
    WHERE lo.Object_XML LIKE '%DDRREF%'
      AND lo.File_Name = (
        SELECT regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
        ) FROM read_xml_objects(getvariable('fm_xml'),
            maximum_file_size=getvariable('max_filesize'))
      )
)
INSERT INTO XMLCalcReferences
SELECT
    loh.Object_UUID, 'LayoutObject', NULL, loh.Subrole,
    loh.Calc_Hash, 'pluginfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    loh.File_Name,
    NULL, NULL,
    NULL, NULL,
    m.SubName  -- Ref_SubName
FROM layout_obj_hashes loh
JOIN DDR_Calculations d
  ON loh.Calc_Hash = d.Calc_Hash
 AND loh.File_Name = d.File_Name
LEFT JOIN MBS_SubnameMap m
       ON m.Calc_UUID = d.Calc_UUID
      AND m.File_Name = d.File_Name
      AND m.Plugin_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'PluginFunctionRef';

-- A.6.10 VariableReference in LayoutObjects
WITH layout_obj_hashes AS (
    SELECT
        lo.Object_UUID,
        lo.File_Name,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM LayoutObjects lo
    WHERE lo.Object_XML LIKE '%DDRREF%'
      AND lo.File_Name = (
        SELECT regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
        ) FROM read_xml_objects(getvariable('fm_xml'),
            maximum_file_size=getvariable('max_filesize'))
      )
)
INSERT INTO XMLCalcReferences
SELECT
    loh.Object_UUID, 'LayoutObject', NULL, loh.Subrole,
    loh.Calc_Hash, 'variable',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    loh.File_Name,
    NULL, NULL,
    CASE
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$$%' THEN 'superglobal'
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$%'  THEN 'global'
        ELSE 'local'
    END,
    'read',
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM layout_obj_hashes loh
JOIN DDR_Calculations d
  ON loh.Calc_Hash = d.Calc_Hash
 AND loh.File_Name = d.File_Name
WHERE d.Chunk_Type = 'VariableReference';


-- ============================================
-- A.7 — Built-in FunctionRef in XMLCalcReferences
-- (PRD prd_universal_function_links.md §5)
-- ============================================
-- Built-in FileMaker-Funktionen (Get, Case, If, Length, …) erscheinen im DDR als
-- FunctionRef-Chunks. Wir spiegeln sie als Ref_Type='function' in XMLCalcReferences
-- für die fünf Quell-Kontexte. Built-ins haben keine UUID in der FileMaker-Lösung —
-- die kanonische Identität liegt in fm_reference.functions / function_name_lookup.
--
-- Für den Token 'Get' wird zusätzlich Ref_SubName aus GetSubparameterMap befüllt
-- (Pendant zur PluginFunction-Sub-Function-Auflösung).

-- A.7.1 FunctionRef in Calculated Fields (DDR_Hash)
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'function',
    NULL,  -- Ref_UUID: built-in functions haben keine UUID
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) AS Ref_Name,
    d.File_Name,
    NULL, NULL,
    NULL, NULL,
    CASE WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) = 'Get'
         THEN g.SubParameter ELSE NULL END
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.DDR_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
LEFT JOIN GetSubparameterMap g
       ON g.Calc_UUID = d.Calc_UUID
      AND g.File_Name = d.File_Name
      AND g.Get_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'FunctionRef'
  AND f.DDR_Hash IS NOT NULL
  AND f.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- A.7.2 FunctionRef in AutoEnter-Calc (AE_Calc_Hash)
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'function',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    NULL, NULL,
    CASE WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) = 'Get'
         THEN g.SubParameter ELSE NULL END
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.AE_Calc_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
LEFT JOIN GetSubparameterMap g
       ON g.Calc_UUID = d.Calc_UUID
      AND g.File_Name = d.File_Name
      AND g.Get_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'FunctionRef'
  AND f.AE_Calc_Hash IS NOT NULL
  AND f.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- A.7.3 FunctionRef in CustomFunctions
INSERT INTO XMLCalcReferences
SELECT
    cf.CF_UUID, 'CustomFunction', NULL, NULL,
    d.Calc_Hash, 'function',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    NULL, NULL,
    CASE WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) = 'Get'
         THEN g.SubParameter ELSE NULL END
FROM CustomFunctionsCatalog cf
JOIN DDR_Calculations d ON cf.DDR_Hash = d.Calc_Hash AND cf.File_Name = d.File_Name
LEFT JOIN GetSubparameterMap g
       ON g.Calc_UUID = d.Calc_UUID
      AND g.File_Name = d.File_Name
      AND g.Get_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'FunctionRef'
  AND cf.DDR_Hash IS NOT NULL
  AND cf.File_Name = (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
  );

-- A.7.4 FunctionRef in Script-Steps
WITH step_hashes AS (
    SELECT
        s.Script_UUID,
        s.Step_Index::VARCHAR AS Step_Index,
        s.File_Name,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM StepsForScripts s
    WHERE s.Parameters_XML LIKE '%DDRREF%'
      AND s.File_Name = (
        SELECT regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
        ) FROM read_xml_objects(getvariable('fm_xml'),
            maximum_file_size=getvariable('max_filesize'))
      )
)
INSERT INTO XMLCalcReferences
SELECT
    sh.Script_UUID, 'Script', sh.Step_Index, sh.Subrole,
    sh.Calc_Hash, 'function',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    sh.File_Name,
    NULL, NULL,
    NULL, NULL,
    CASE WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) = 'Get'
         THEN g.SubParameter ELSE NULL END
FROM step_hashes sh
JOIN DDR_Calculations d
  ON sh.Calc_Hash = d.Calc_Hash
 AND sh.File_Name = d.File_Name
LEFT JOIN GetSubparameterMap g
       ON g.Calc_UUID = d.Calc_UUID
      AND g.File_Name = d.File_Name
      AND g.Get_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'FunctionRef';

-- A.7.5 FunctionRef in LayoutObjects
WITH layout_obj_hashes AS (
    SELECT
        lo.Object_UUID,
        lo.File_Name,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM LayoutObjects lo
    WHERE lo.Object_XML LIKE '%DDRREF%'
      AND lo.File_Name = (
        SELECT regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
        ) FROM read_xml_objects(getvariable('fm_xml'),
            maximum_file_size=getvariable('max_filesize'))
      )
)
INSERT INTO XMLCalcReferences
SELECT
    loh.Object_UUID, 'LayoutObject', NULL, loh.Subrole,
    loh.Calc_Hash, 'function',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    loh.File_Name,
    NULL, NULL,
    NULL, NULL,
    CASE WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) = 'Get'
         THEN g.SubParameter ELSE NULL END
FROM layout_obj_hashes loh
JOIN DDR_Calculations d
  ON loh.Calc_Hash = d.Calc_Hash
 AND loh.File_Name = d.File_Name
LEFT JOIN GetSubparameterMap g
       ON g.Calc_UUID = d.Calc_UUID
      AND g.File_Name = d.File_Name
      AND g.Get_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'FunctionRef';


-- ============================================
-- PHASE 4: OPTIONALE KATALOGE
-- ============================================


-- ============================================
-- 20. PasteIndexList
-- ============================================
-- Sehr einfach: Liste von Object-IDs
-- Wird verwendet für Copy/Paste Operations
CREATE TABLE IF NOT EXISTS PasteIndexList (
    Object_ID BIGINT,
    List_Index BIGINT,
    File_Name VARCHAR,
    PRIMARY KEY (Object_ID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
paste_objects AS (
    SELECT
        unnest(xml_extract_elements(xml, '//PasteIndexList/Object')) as object_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO PasteIndexList
SELECT
    xml_extract_text(object_xml, '/Object/@id')[1]::BIGINT as Object_ID,
    ROW_NUMBER() OVER (ORDER BY Object_ID) as List_Index,
    fn.File_Name as File_Name
FROM paste_objects
CROSS JOIN filename_normalized fn
WHERE Object_ID IS NOT NULL
ON CONFLICT (Object_ID, File_Name) DO UPDATE SET
    List_Index = EXCLUDED.List_Index;


-- ============================================
-- 21. BaseDirectoryCatalog
-- ============================================
-- Basis-Directory der FileMaker-Datei
-- Pattern: XPath für nested Element
CREATE TABLE IF NOT EXISTS BaseDirectoryCatalog (
    BD_Name VARCHAR,
    BD_ID BIGINT,
    BD_RelativeTo VARCHAR,
    BD_UUID VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (BD_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_dir AS (
    SELECT
        unnest(xml_extract_elements(xml, '//BaseDirectoryCatalog/BaseDirectory')) as dir_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO BaseDirectoryCatalog
SELECT
    xml_extract_text(dir_xml, '/BaseDirectory/@name')[1] as BD_Name,
    xml_extract_text(dir_xml, '/BaseDirectory/@id')[1]::BIGINT as BD_ID,
    xml_extract_text(dir_xml, '/BaseDirectory/@relativeTo')[1] as BD_RelativeTo,
    xml_extract_text(dir_xml, '/BaseDirectory/UUID/text()')[1] as BD_UUID,
    fn.File_Name as File_Name
FROM raw_dir
CROSS JOIN filename_normalized fn
WHERE xml_extract_text(dir_xml, '/BaseDirectory/@id')[1] IS NOT NULL
ON CONFLICT (BD_UUID, File_Name) DO UPDATE SET
    BD_Name = EXCLUDED.BD_Name,
    BD_ID = EXCLUDED.BD_ID,
    BD_RelativeTo = EXCLUDED.BD_RelativeTo;


-- ============================================
-- 22. ScriptTriggers
-- ============================================
-- Script Trigger (OnFirstWindowOpen, OnLastWindowClose, etc.)
-- Pattern: XPath für nested Element in Metadata
CREATE TABLE IF NOT EXISTS ScriptTriggers (
    Trigger_ID BIGINT,
    Trigger_Action VARCHAR,
    Trigger_BrowseMode VARCHAR,
    Script_ID BIGINT,
    Script_Name VARCHAR,
    Script_UUID VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Trigger_ID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_triggers AS (
    SELECT
        unnest(xml_extract_elements(xml, '//ScriptTriggers/ScriptTrigger')) as trigger_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO ScriptTriggers
SELECT
    xml_extract_text(trigger_xml, '/ScriptTrigger/@id')[1]::BIGINT as Trigger_ID,
    xml_extract_text(trigger_xml, '/ScriptTrigger/@action')[1] as Trigger_Action,
    xml_extract_text(trigger_xml, '/ScriptTrigger/@browseMode')[1] as Trigger_BrowseMode,

    -- Script-Referenz
    xml_extract_text(trigger_xml, '/ScriptTrigger/ScriptReference/@id')[1]::BIGINT as Script_ID,
    xml_extract_text(trigger_xml, '/ScriptTrigger/ScriptReference/@name')[1] as Script_Name,
    xml_extract_text(trigger_xml, '/ScriptTrigger/ScriptReference/@UUID')[1] as Script_UUID,

    fn.File_Name as File_Name

FROM raw_triggers
CROSS JOIN filename_normalized fn
WHERE xml_extract_text(trigger_xml, '/ScriptTrigger/@id')[1] IS NOT NULL
ON CONFLICT (Trigger_ID, File_Name) DO UPDATE SET
    Trigger_Action = EXCLUDED.Trigger_Action,
    Trigger_BrowseMode = EXCLUDED.Trigger_BrowseMode,
    Script_ID = EXCLUDED.Script_ID,
    Script_Name = EXCLUDED.Script_Name,
    Script_UUID = EXCLUDED.Script_UUID;


-- ============================================
-- 23. ExtendedPrivilegesCatalog
-- ============================================
-- Erweiterte Berechtigungen (fmwebdirect, fmxdbc, fmapp, etc.)
-- Pattern: XPath mit UNNEST für PrivilegeSetReferences
CREATE TABLE IF NOT EXISTS ExtendedPrivilegesCatalog (
    EP_ID BIGINT,
    EP_Name VARCHAR,
    EP_Description VARCHAR,
    EP_UUID VARCHAR,
    PrivilegeSet_IDs BIGINT[],
    PrivilegeSet_Names VARCHAR[],
    File_Name VARCHAR,
    PRIMARY KEY (EP_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_privileges AS (
    SELECT
        unnest(xml_extract_elements(xml, '//ExtendedPrivilegesCatalog/ObjectList/ExtendedPrivilege')) as priv_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO ExtendedPrivilegesCatalog
SELECT
    xml_extract_text(priv_xml, '/ExtendedPrivilege/@id')[1]::BIGINT as EP_ID,
    xml_extract_text(priv_xml, '/ExtendedPrivilege/@name')[1] as EP_Name,
    xml_extract_text(priv_xml, '/ExtendedPrivilege/Description/text()')[1] as EP_Description,
    xml_extract_text(priv_xml, '/ExtendedPrivilege/UUID/text()')[1] as EP_UUID,

    -- Array of PrivilegeSet IDs und Namen
    list(xml_extract_text(ps_xml, '/PrivilegeSetReference/@id')[1]::BIGINT) as PrivilegeSet_IDs,
    list(xml_extract_text(ps_xml, '/PrivilegeSetReference/@name')[1]) as PrivilegeSet_Names,

    fn.File_Name as File_Name

FROM raw_privileges
CROSS JOIN filename_normalized fn
LEFT JOIN LATERAL (
    SELECT unnest(xml_extract_elements(priv_xml, '//ObjectList/PrivilegeSetReference')) as ps_xml
) ps ON true
GROUP BY EP_ID, EP_Name, EP_Description, EP_UUID, fn.File_Name
ON CONFLICT (EP_UUID, File_Name) DO UPDATE SET
    EP_ID = EXCLUDED.EP_ID,
    EP_Name = EXCLUDED.EP_Name,
    EP_Description = EXCLUDED.EP_Description,
    PrivilegeSet_IDs = EXCLUDED.PrivilegeSet_IDs,
    PrivilegeSet_Names = EXCLUDED.PrivilegeSet_Names;


-- ============================================
-- 24. CustomMenuCatalog
-- ============================================
-- Benutzerdefinierte Menüs mit verschachtelter Hierarchie
-- Pattern: XPath mit JSON für polymorphe Strukturen
CREATE TABLE IF NOT EXISTS CustomMenuCatalog (
    Menu_ID BIGINT,
    Menu_Name VARCHAR,
    Menu_UUID VARCHAR,
    Menu_XML VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Menu_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_menus AS (
    SELECT
        unnest(xml_extract_elements(xml, '//CustomMenuCatalog/CustomMenu')) as menu_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO CustomMenuCatalog
SELECT
    xml_extract_text(menu_xml, '/CustomMenu/@id')[1]::BIGINT as Menu_ID,
    xml_extract_text(menu_xml, '/CustomMenu/@name')[1] as Menu_Name,
    xml_extract_text(menu_xml, '/CustomMenu/UUID/text()')[1] as Menu_UUID,

    -- Vollständige Menü-Struktur als XML (enthält verschachtelte Items)
    menu_xml::VARCHAR as Menu_XML,

    fn.File_Name as File_Name

FROM raw_menus
CROSS JOIN filename_normalized fn
WHERE xml_extract_text(menu_xml, '/CustomMenu/@id')[1] IS NOT NULL
ON CONFLICT (Menu_UUID, File_Name) DO UPDATE SET
    Menu_ID = EXCLUDED.Menu_ID,
    Menu_Name = EXCLUDED.Menu_Name,
    Menu_XML = EXCLUDED.Menu_XML;


-- ============================================
-- 25. ThemeCatalog
-- ============================================
-- CSS-Regelsätze für Layouts
-- Pattern: XPath mit JSON für CSS-Strukturen
-- HINWEIS: Theme-Struktur ist sehr komplex mit CSS-Definitionen
CREATE TABLE IF NOT EXISTS ThemeCatalog (
    Theme_ID BIGINT,
    Theme_Name VARCHAR,
    Theme_UUID VARCHAR,
    Theme_XML VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Theme_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT
        regexp_replace(
            xml_extract_text(xml, '/FMSaveAsXML/@File')[1],
            '\.fmp12$',
            ''
        ) as File_Name
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
raw_themes AS (
    SELECT
        unnest(xml_extract_elements(xml, '//ThemeCatalog/Theme')) as theme_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO ThemeCatalog
SELECT
    xml_extract_text(theme_xml, '/Theme/@id')[1]::BIGINT as Theme_ID,
    xml_extract_text(theme_xml, '/Theme/@name')[1] as Theme_Name,
    xml_extract_text(theme_xml, '/Theme/UUID/text()')[1] as Theme_UUID,

    -- Vollständige Theme-Struktur als JSON (enthält CSS-Regelsätze)
    theme_xml::VARCHAR as Theme_XML,

    fn.File_Name as File_Name

FROM raw_themes
CROSS JOIN filename_normalized fn
WHERE xml_extract_text(theme_xml, '/Theme/@id')[1] IS NOT NULL
ON CONFLICT (Theme_UUID, File_Name) DO UPDATE SET
    Theme_ID = EXCLUDED.Theme_ID,
    Theme_Name = EXCLUDED.Theme_Name,
    Theme_XML = EXCLUDED.Theme_XML;


-- ============================================
-- SchemaInfo aktualisieren
-- ============================================
-- Letzter Schritt: nach erfolgreichem Import den Schema-Stand persistieren.
-- Wenn der Lauf vorher abbricht, bleibt der alte SchemaInfo-Eintrag aktuell,
-- sodass die Detection beim nächsten Aufruf den Drift sauber erkennt.
INSERT INTO SchemaInfo (Schema_Version, Schema_Hash, Schema_Built_At, Builder_Notes)
VALUES (
    getvariable('schema_version'),
    getvariable('schema_hash'),
    CURRENT_TIMESTAMP,
    getvariable('schema_notes')
);


-- ============================================
-- IMPLEMENTIERUNGS-STATUS
-- ============================================
-- ✅ Phase 0: Basis-Kataloge (10 Tabellen)
-- ✅ Phase 1: Erweiterte Basis-Kataloge (5 Tabellen)
-- ✅ Phase 2: DDR_INFO Integration (3 Tabellen)
-- ✅ Phase 3: Layout-Objekte (1 Tabelle)
-- ✅ Phase 4: Optionale Kataloge (6 Tabellen)
-- ✅ Phase 5: SchemaInfo (Versionierung & Auto-Heal)
--
-- GESAMT: 26 Tabellen erfolgreich implementiert



