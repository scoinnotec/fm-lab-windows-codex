-- Count Fields per Base Table
SELECT
    b.BT_ID,
    b.BT_Name,
    COUNT(f.Field_ID) AS Field_Count
FROM BaseTableCatalog b
LEFT JOIN FieldsForTables f ON b.BT_ID = f.Table_ID
GROUP BY b.BT_ID, b.BT_Name
ORDER BY Field_Count DESC, b.BT_Name;