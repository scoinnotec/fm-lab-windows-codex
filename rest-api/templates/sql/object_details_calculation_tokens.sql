-- @template_type: report
-- @description: Standalone calculation by hash (Calculations have no top-level UUID)
-- @params: hash (required)
-- @output_format: tokens
-- @author: Marcel
-- @version: 1.1
-- @tags: calculations, ddr, tokens

-- Calc_Hash is not unique: multiple Calc_UUIDs may share a hash (semantic dedup).
-- Pick exactly one Calc_UUID per hash to avoid duplicate chunk rows.
WITH calc_uuid AS (
  SELECT MIN(Calc_UUID) AS Calc_UUID
  FROM DDR_Calculations
  WHERE Calc_Hash = getvariable('hash')
)
SELECT
  d.Calc_Hash AS hash,
  d.Chunk_Index AS chunk_index,
  d.Chunk_Type AS chunk_type,
  d.Chunk_Content AS chunk_content
FROM DDR_Calculations d
JOIN calc_uuid c ON d.Calc_UUID = c.Calc_UUID
ORDER BY d.Chunk_Index;
