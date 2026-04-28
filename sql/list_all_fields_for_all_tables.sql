-- List all Fields across all Tables
SELECT
    Table_Name,
    Field_Name,
    Field_Type,
    Data_Type,
    CASE WHEN Is_Global THEN 'Global' ELSE '' END AS Storage
FROM FieldsForTables
ORDER BY Table_Name, Field_ID;