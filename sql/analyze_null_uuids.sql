/*
-- Analyse-Script für NULL UUIDs in FileMaker XML-Dateien
-- Untersucht RelationshipCatalog und FieldsForTables auf fehlende UUIDs
--
-- Usage: duckdb -c "SET VARIABLE fm_xml = 'Artikel.xml';" < sql/analyze_null_uuids.sql
--
-- Version 0.1
-- Date: 2026-01-14
*/

INSTALL webbed FROM community;
LOAD webbed;

SET file_search_path = COALESCE(NULLIF(getenv('FM_XML_DIR'), ''), 'xml');
SET VARIABLE max_filesize TO 256000000; -- 256 MB

.mode table
.header on

-- ========================================
-- Dateiname extrahieren
-- ========================================
SELECT '=== Analyzing File ===' as Info;

SELECT
    xml_extract_text(xml, '/FMSaveAsXML/@File')[1] as Filename,
    xml_extract_text(xml, '/FMSaveAsXML/@Source')[1] as FileMaker_Version,
    COALESCE(xml_extract_text(xml, '/FMSaveAsXML/@Has_DDR_INFO')[1], 'False') as Has_DDR_INFO
FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'));

-- ========================================
-- RELATIONSHIPS ANALYSE
-- ========================================
SELECT '=== Relationship Analysis ===' as Info;

WITH relationship_data AS (
    SELECT
        id AS Rel_ID,
        LeftTable.TableOccurrenceReference.name AS Left_TO_Name,
        RightTable.TableOccurrenceReference.name AS Right_TO_Name,
        p.LeftField.FieldReference.name AS Left_Field_Name,
        p.LeftField.FieldReference.UUID AS Left_Field_UUID,
        p.RightField.FieldReference.name AS Right_Field_Name,
        p.RightField.FieldReference.UUID AS Right_Field_UUID
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
)
SELECT
    COUNT(*) as Total_Relationships,
    COUNT(CASE WHEN Left_Field_UUID IS NULL THEN 1 END) as Left_Field_UUID_NULL,
    COUNT(CASE WHEN Right_Field_UUID IS NULL THEN 1 END) as Right_Field_UUID_NULL,
    COUNT(CASE WHEN Left_Field_UUID IS NULL OR Right_Field_UUID IS NULL THEN 1 END) as Either_UUID_NULL
FROM relationship_data;

-- Details zu NULL-Relationships
SELECT '=== Relationships with NULL UUIDs (First 10) ===' as Info;

WITH relationship_data AS (
    SELECT
        id AS Rel_ID,
        LeftTable.TableOccurrenceReference.name AS Left_TO_Name,
        RightTable.TableOccurrenceReference.name AS Right_TO_Name,
        p.LeftField.FieldReference.name AS Left_Field_Name,
        p.LeftField.FieldReference.UUID AS Left_Field_UUID,
        p.RightField.FieldReference.name AS Right_Field_Name,
        p.RightField.FieldReference.UUID AS Right_Field_UUID
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
)
SELECT
    Rel_ID,
    Left_TO_Name,
    Left_Field_Name,
    CASE WHEN Left_Field_UUID IS NULL THEN 'NULL' ELSE 'OK' END as Left_UUID_Status,
    Right_TO_Name,
    Right_Field_Name,
    CASE WHEN Right_Field_UUID IS NULL THEN 'NULL' ELSE 'OK' END as Right_UUID_Status
FROM relationship_data
WHERE Left_Field_UUID IS NULL OR Right_Field_UUID IS NULL
LIMIT 10;

-- ========================================
-- FIELDS ANALYSE
-- ========================================
SELECT '=== Field Analysis ===' as Info;

WITH field_data AS (
    SELECT
        BaseTableReference.id AS Table_ID,
        BaseTableReference.name AS Table_Name,
        f.id AS Field_ID,
        f.name AS Field_Name,
        f.UUID."#text" AS Field_UUID
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
                    "Storage" STRUCT("global" BOOLEAN, "maxRepetitions" INTEGER)
                )[]
            )'
        }
    )
    CROSS JOIN UNNEST(ObjectList.Field) AS t(f)
)
SELECT
    COUNT(*) as Total_Fields,
    COUNT(CASE WHEN Field_ID IS NULL THEN 1 END) as Field_ID_NULL,
    COUNT(CASE WHEN Field_UUID IS NULL THEN 1 END) as Field_UUID_NULL,
    COUNT(CASE WHEN Field_ID IS NULL OR Field_UUID IS NULL THEN 1 END) as Either_NULL
FROM field_data;

-- Details zu NULL-Fields
SELECT '=== Fields with NULL IDs or UUIDs (First 10) ===' as Info;

WITH field_data AS (
    SELECT
        BaseTableReference.id AS Table_ID,
        BaseTableReference.name AS Table_Name,
        f.id AS Field_ID,
        f.name AS Field_Name,
        f.fieldtype AS Field_Type,
        f.UUID."#text" AS Field_UUID
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
                    "Storage" STRUCT("global" BOOLEAN, "maxRepetitions" INTEGER)
                )[]
            )'
        }
    )
    CROSS JOIN UNNEST(ObjectList.Field) AS t(f)
)
SELECT
    Table_Name,
    Field_Name,
    Field_Type,
    CASE WHEN Field_ID IS NULL THEN 'NULL' ELSE Field_ID::VARCHAR END as Field_ID_Status,
    CASE WHEN Field_UUID IS NULL THEN 'NULL' ELSE 'OK' END as Field_UUID_Status
FROM field_data
WHERE Field_ID IS NULL OR Field_UUID IS NULL
LIMIT 10;
