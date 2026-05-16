-- ============================================
-- create_layout_object_quality_analysis.sql
-- ============================================
-- Precomputed layout object quality findings.
--
-- Purpose:
-- Find suspicious FileMaker layout objects without expensive live scans:
-- objects outside the visible layout/parent area, empty text objects, tiny or
-- invalid leftover artifacts, duplicate/copy-like object names, and significant
-- overlaps including stack order hints.

SET threads=4;
SET preserve_insertion_order=false;

DROP TABLE IF EXISTS LayoutObjectQualityFindings;

CREATE TABLE LayoutObjectQualityFindings AS
WITH RECURSIVE
layout_bounds AS (
  SELECT
    l.L_ID AS Layout_ID,
    l.L_UUID AS Layout_UUID,
    l.L_Name AS Layout_Name,
    l.L_TO_Name AS Layout_TO_Name,
    l.File_Name,
    MIN(lp.Part_Absolute) AS Layout_Top,
    MAX(lp.Part_Absolute + lp.Part_Size) AS Layout_Bottom
  FROM Layouts l
  LEFT JOIN LayoutParts lp
    ON lp.Layout_ID = l.L_ID
   AND lp.File_Name = l.File_Name
  GROUP BY l.L_ID, l.L_UUID, l.L_Name, l.L_TO_Name, l.File_Name
),
layout_objects_raw AS (
  SELECT
    lb.Layout_UUID,
    lb.Layout_Name,
    lb.Layout_TO_Name,
    lb.Layout_Top,
    lb.Layout_Bottom,
    lo.Layout_ID,
    lo.Part_Type,
    lo.Object_ID,
    lo.Object_Type,
    lo.Object_Name,
    lo.Object_UUID,
    lo.Bounds_Top,
    lo.Bounds_Left,
    lo.Bounds_Bottom,
    lo.Bounds_Right,
    lo.Parent_Object_ID,
    parent_lo.Object_Type AS Parent_Object_Type,
    lo.Nesting_Level,
    lo.Z_Order,
    lo.Text_Content,
    lo.File_Name
  FROM LayoutObjects lo
  JOIN layout_bounds lb
    ON lb.Layout_ID = lo.Layout_ID
   AND lb.File_Name = lo.File_Name
  LEFT JOIN LayoutObjects parent_lo
    ON parent_lo.Layout_ID = lo.Layout_ID
   AND parent_lo.File_Name = lo.File_Name
   AND parent_lo.Object_ID = lo.Parent_Object_ID
),
objects_absolute AS (
  SELECT
    Layout_UUID,
    Layout_Name,
    Layout_TO_Name,
    Layout_Top,
    Layout_Bottom,
    Layout_ID,
    Part_Type,
    Object_ID,
    Object_Type,
    Object_Name,
    Object_UUID,
    Bounds_Top AS Abs_Top,
    Bounds_Left AS Abs_Left,
    Bounds_Bottom AS Abs_Bottom,
    Bounds_Right AS Abs_Right,
    Parent_Object_ID,
    Parent_Object_Type,
    Nesting_Level,
    Z_Order,
    Text_Content,
    File_Name
  FROM layout_objects_raw
  WHERE Parent_Object_ID IS NULL

  UNION ALL

  SELECT
    child.Layout_UUID,
    child.Layout_Name,
    child.Layout_TO_Name,
    child.Layout_Top,
    child.Layout_Bottom,
    child.Layout_ID,
    child.Part_Type,
    child.Object_ID,
    child.Object_Type,
    child.Object_Name,
    child.Object_UUID,
    parent.Abs_Top + child.Bounds_Top AS Abs_Top,
    parent.Abs_Left + child.Bounds_Left AS Abs_Left,
    parent.Abs_Top + child.Bounds_Bottom AS Abs_Bottom,
    parent.Abs_Left + child.Bounds_Right AS Abs_Right,
    child.Parent_Object_ID,
    child.Parent_Object_Type,
    child.Nesting_Level,
    child.Z_Order,
    child.Text_Content,
    child.File_Name
  FROM layout_objects_raw child
  JOIN objects_absolute parent
    ON parent.Layout_ID = child.Layout_ID
   AND parent.File_Name = child.File_Name
   AND parent.Object_ID = child.Parent_Object_ID
),
objects_with_metrics AS (
  SELECT
    *,
    COALESCE(Abs_Right, 0) - COALESCE(Abs_Left, 0) AS Width,
    COALESCE(Abs_Bottom, 0) - COALESCE(Abs_Top, 0) AS Height,
    GREATEST(0, COALESCE(Abs_Right, 0) - COALESCE(Abs_Left, 0))
      * GREATEST(0, COALESCE(Abs_Bottom, 0) - COALESCE(Abs_Top, 0)) AS Area
  FROM objects_absolute
),
ancestor_pairs(child_uuid, ancestor_uuid, layout_id, file_name) AS (
  SELECT
    child.Object_UUID,
    parent.Object_UUID,
    child.Layout_ID,
    child.File_Name
  FROM objects_absolute child
  JOIN objects_absolute parent
    ON parent.Layout_ID = child.Layout_ID
   AND parent.File_Name = child.File_Name
   AND parent.Object_ID = child.Parent_Object_ID

  UNION ALL

  SELECT
    ap.child_uuid,
    parent.Object_UUID,
    ap.layout_id,
    ap.file_name
  FROM ancestor_pairs ap
  JOIN objects_absolute ancestor
    ON ancestor.Layout_ID = ap.layout_id
   AND ancestor.File_Name = ap.file_name
   AND ancestor.Object_UUID = ap.ancestor_uuid
  JOIN objects_absolute parent
    ON parent.Layout_ID = ancestor.Layout_ID
   AND parent.File_Name = ancestor.File_Name
   AND parent.Object_ID = ancestor.Parent_Object_ID
),
duplicate_names AS (
  SELECT
    Object_UUID,
    File_Name,
    COUNT(*) OVER (
      PARTITION BY File_Name, Layout_ID, lower(trim(Object_Name))
    ) AS Duplicate_Count,
    string_agg(
      CAST(Object_ID AS VARCHAR) || ':' || COALESCE(Object_Type, '?'),
      ', ' ORDER BY Object_ID
    ) OVER (
      PARTITION BY File_Name, Layout_ID, lower(trim(Object_Name))
    ) AS Duplicate_Members
  FROM objects_with_metrics
  WHERE COALESCE(trim(Object_Name), '') <> ''
),
overlap_pairs AS (
  SELECT
    a.*,
    b.Object_UUID AS Related_Object_UUID,
    b.Object_ID AS Related_Object_ID,
    b.Object_Type AS Related_Object_Type,
    b.Object_Name AS Related_Object_Name,
    b.Z_Order AS Related_Z_Order,
    b.Parent_Object_Type AS Related_Parent_Object_Type,
    b.Nesting_Level AS Related_Nesting_Level,
    b.Abs_Top AS Related_Abs_Top,
    b.Abs_Left AS Related_Abs_Left,
    b.Abs_Bottom AS Related_Abs_Bottom,
    b.Abs_Right AS Related_Abs_Right,
    GREATEST(0, LEAST(a.Abs_Right, b.Abs_Right) - GREATEST(a.Abs_Left, b.Abs_Left)) AS Overlap_Width,
    GREATEST(0, LEAST(a.Abs_Bottom, b.Abs_Bottom) - GREATEST(a.Abs_Top, b.Abs_Top)) AS Overlap_Height,
    GREATEST(0, LEAST(a.Abs_Right, b.Abs_Right) - GREATEST(a.Abs_Left, b.Abs_Left))
      * GREATEST(0, LEAST(a.Abs_Bottom, b.Abs_Bottom) - GREATEST(a.Abs_Top, b.Abs_Top)) AS Overlap_Area,
    LEAST(
      (GREATEST(0, LEAST(a.Abs_Right, b.Abs_Right) - GREATEST(a.Abs_Left, b.Abs_Left))
        * GREATEST(0, LEAST(a.Abs_Bottom, b.Abs_Bottom) - GREATEST(a.Abs_Top, b.Abs_Top))) / NULLIF(a.Area, 0),
      (GREATEST(0, LEAST(a.Abs_Right, b.Abs_Right) - GREATEST(a.Abs_Left, b.Abs_Left))
        * GREATEST(0, LEAST(a.Abs_Bottom, b.Abs_Bottom) - GREATEST(a.Abs_Top, b.Abs_Top))) / NULLIF(b.Area, 0)
    ) AS Overlap_Ratio
  FROM objects_with_metrics a
  JOIN objects_with_metrics b
    ON b.File_Name = a.File_Name
   AND b.Layout_ID = a.Layout_ID
   AND b.Object_UUID > a.Object_UUID
   AND a.Abs_Left < b.Abs_Right
   AND a.Abs_Right > b.Abs_Left
   AND a.Abs_Top < b.Abs_Bottom
   AND a.Abs_Bottom > b.Abs_Top
   AND a.Width > 2
   AND a.Height > 2
   AND b.Width > 2
   AND b.Height > 2
  LEFT JOIN ancestor_pairs ap1
    ON ap1.file_name = a.File_Name
   AND ap1.layout_id = a.Layout_ID
   AND ap1.child_uuid = a.Object_UUID
   AND ap1.ancestor_uuid = b.Object_UUID
  LEFT JOIN ancestor_pairs ap2
    ON ap2.file_name = a.File_Name
   AND ap2.layout_id = a.Layout_ID
   AND ap2.child_uuid = b.Object_UUID
   AND ap2.ancestor_uuid = a.Object_UUID
  WHERE ap1.child_uuid IS NULL
    AND ap2.child_uuid IS NULL
    AND NOT (
      a.Parent_Object_ID IS NOT NULL
      AND a.Parent_Object_ID = b.Parent_Object_ID
      AND a.Object_Type = 'Panel'
      AND b.Object_Type = 'Panel'
      AND COALESCE(a.Parent_Object_Type, b.Parent_Object_Type, '') IN ('Tab Control', 'Slide Control')
    )
),
findings AS (
  SELECT
    md5('outside-layout|' || Object_UUID || '|' || File_Name) AS Finding_ID,
    'Außerhalb Layout' AS Issue_Category,
    'Objekt außerhalb des Layoutbereichs' AS Issue_Type,
    'high' AS Severity,
    Layout_UUID,
    Layout_Name,
    Layout_TO_Name,
    File_Name,
    Layout_ID,
    Object_UUID,
    Object_ID,
    Object_Name,
    Object_Type,
    Abs_Top,
    Abs_Left,
    Abs_Bottom,
    Abs_Right,
    Width,
    Height,
    Z_Order,
    Nesting_Level,
    Parent_Object_ID,
    NULL::VARCHAR AS Related_Object_UUID,
    NULL::BIGINT AS Related_Object_ID,
    NULL::VARCHAR AS Related_Object_Name,
    NULL::VARCHAR AS Related_Object_Type,
    NULL::INTEGER AS Related_Z_Order,
    NULL::DOUBLE AS Overlap_Area,
    NULL::DOUBLE AS Overlap_Ratio,
    'Layoutbereich Y=' || CAST(COALESCE(Layout_Top, 0) AS VARCHAR) || ' bis ' ||
      CAST(COALESCE(Layout_Bottom, 0) AS VARCHAR) || '; Objekt=' ||
      CAST(Abs_Left AS VARCHAR) || ',' || CAST(Abs_Top AS VARCHAR) || ' - ' ||
      CAST(Abs_Right AS VARCHAR) || ',' || CAST(Abs_Bottom AS VARCHAR) AS Detail_Text,
    10 AS Sort_Order
  FROM objects_with_metrics
  WHERE Abs_Left < 0
     OR Abs_Right < 0
     OR Abs_Bottom < COALESCE(Layout_Top, 0)
     OR Abs_Top > COALESCE(Layout_Bottom, 0)

  UNION ALL

  SELECT
    md5('outside-parent|' || child.Object_UUID || '|' || child.File_Name) AS Finding_ID,
    'Außerhalb Parent' AS Issue_Category,
    'Verschachteltes Objekt ragt aus Parent heraus' AS Issue_Type,
    'medium' AS Severity,
    child.Layout_UUID,
    child.Layout_Name,
    child.Layout_TO_Name,
    child.File_Name,
    child.Layout_ID,
    child.Object_UUID,
    child.Object_ID,
    child.Object_Name,
    child.Object_Type,
    child.Abs_Top,
    child.Abs_Left,
    child.Abs_Bottom,
    child.Abs_Right,
    child.Width,
    child.Height,
    child.Z_Order,
    child.Nesting_Level,
    child.Parent_Object_ID,
    parent.Object_UUID AS Related_Object_UUID,
    parent.Object_ID AS Related_Object_ID,
    parent.Object_Name AS Related_Object_Name,
    parent.Object_Type AS Related_Object_Type,
    parent.Z_Order AS Related_Z_Order,
    NULL::DOUBLE AS Overlap_Area,
    NULL::DOUBLE AS Overlap_Ratio,
    'Parent=' || COALESCE(parent.Object_Name, parent.Object_Type, 'Objekt') ||
      ' [' || CAST(parent.Object_ID AS VARCHAR) || '] Bounds ' ||
      CAST(parent.Abs_Left AS VARCHAR) || ',' || CAST(parent.Abs_Top AS VARCHAR) || ' - ' ||
      CAST(parent.Abs_Right AS VARCHAR) || ',' || CAST(parent.Abs_Bottom AS VARCHAR) AS Detail_Text,
    20 AS Sort_Order
  FROM objects_with_metrics child
  JOIN objects_with_metrics parent
    ON parent.Layout_ID = child.Layout_ID
   AND parent.File_Name = child.File_Name
   AND parent.Object_ID = child.Parent_Object_ID
  WHERE child.Abs_Left < parent.Abs_Left - 1
     OR child.Abs_Top < parent.Abs_Top - 1
     OR child.Abs_Right > parent.Abs_Right + 1
     OR child.Abs_Bottom > parent.Abs_Bottom + 1

  UNION ALL

  SELECT
    md5('empty-text|' || Object_UUID || '|' || File_Name) AS Finding_ID,
    'Leere Textobjekte' AS Issue_Category,
    'Leeres Textobjekt' AS Issue_Type,
    'medium' AS Severity,
    Layout_UUID,
    Layout_Name,
    Layout_TO_Name,
    File_Name,
    Layout_ID,
    Object_UUID,
    Object_ID,
    Object_Name,
    Object_Type,
    Abs_Top,
    Abs_Left,
    Abs_Bottom,
    Abs_Right,
    Width,
    Height,
    Z_Order,
    Nesting_Level,
    Parent_Object_ID,
    NULL::VARCHAR AS Related_Object_UUID,
    NULL::BIGINT AS Related_Object_ID,
    NULL::VARCHAR AS Related_Object_Name,
    NULL::VARCHAR AS Related_Object_Type,
    NULL::INTEGER AS Related_Z_Order,
    NULL::DOUBLE AS Overlap_Area,
    NULL::DOUBLE AS Overlap_Ratio,
    'Textobjekt ohne sichtbaren Textinhalt' AS Detail_Text,
    30 AS Sort_Order
  FROM objects_with_metrics
  WHERE Object_Type = 'Text'
    AND regexp_replace(COALESCE(Text_Content, ''), '[[:space:]]+', '', 'g') = ''

  UNION ALL

  SELECT
    md5('invalid-size|' || Object_UUID || '|' || File_Name) AS Finding_ID,
    'Nullmaß' AS Issue_Category,
    'Objekt mit ungültiger oder leerer Größe' AS Issue_Type,
    'high' AS Severity,
    Layout_UUID,
    Layout_Name,
    Layout_TO_Name,
    File_Name,
    Layout_ID,
    Object_UUID,
    Object_ID,
    Object_Name,
    Object_Type,
    Abs_Top,
    Abs_Left,
    Abs_Bottom,
    Abs_Right,
    Width,
    Height,
    Z_Order,
    Nesting_Level,
    Parent_Object_ID,
    NULL::VARCHAR AS Related_Object_UUID,
    NULL::BIGINT AS Related_Object_ID,
    NULL::VARCHAR AS Related_Object_Name,
    NULL::VARCHAR AS Related_Object_Type,
    NULL::INTEGER AS Related_Z_Order,
    NULL::DOUBLE AS Overlap_Area,
    NULL::DOUBLE AS Overlap_Ratio,
    'Breite=' || CAST(Width AS VARCHAR) || ', Höhe=' || CAST(Height AS VARCHAR) AS Detail_Text,
    40 AS Sort_Order
  FROM objects_with_metrics
  WHERE (Width <= 0 OR Height <= 0)
    AND (
      Object_Type <> 'Line'
      OR Width = 0 AND Height = 0
      OR Width < 0
      OR Height < 0
    )

  UNION ALL

  SELECT
    md5('tiny-object|' || Object_UUID || '|' || File_Name) AS Finding_ID,
    'Sehr kleine Objekte' AS Issue_Category,
    'Einzelpixel oder sehr kleines Objekt' AS Issue_Type,
    'medium' AS Severity,
    Layout_UUID,
    Layout_Name,
    Layout_TO_Name,
    File_Name,
    Layout_ID,
    Object_UUID,
    Object_ID,
    Object_Name,
    Object_Type,
    Abs_Top,
    Abs_Left,
    Abs_Bottom,
    Abs_Right,
    Width,
    Height,
    Z_Order,
    Nesting_Level,
    Parent_Object_ID,
    NULL::VARCHAR AS Related_Object_UUID,
    NULL::BIGINT AS Related_Object_ID,
    NULL::VARCHAR AS Related_Object_Name,
    NULL::VARCHAR AS Related_Object_Type,
    NULL::INTEGER AS Related_Z_Order,
    NULL::DOUBLE AS Overlap_Area,
    NULL::DOUBLE AS Overlap_Ratio,
    'Breite=' || CAST(Width AS VARCHAR) || ', Höhe=' || CAST(Height AS VARCHAR) AS Detail_Text,
    50 AS Sort_Order
  FROM objects_with_metrics
  WHERE Width > 0
    AND Height > 0
    AND Width <= 2
    AND Height <= 2

  UNION ALL

  SELECT
    md5('duplicate-name|' || o.Object_UUID || '|' || o.File_Name) AS Finding_ID,
    'Doppelte Objektnamen' AS Issue_Category,
    'Identischer Objektname im selben Layout' AS Issue_Type,
    'high' AS Severity,
    o.Layout_UUID,
    o.Layout_Name,
    o.Layout_TO_Name,
    o.File_Name,
    o.Layout_ID,
    o.Object_UUID,
    o.Object_ID,
    o.Object_Name,
    o.Object_Type,
    o.Abs_Top,
    o.Abs_Left,
    o.Abs_Bottom,
    o.Abs_Right,
    o.Width,
    o.Height,
    o.Z_Order,
    o.Nesting_Level,
    o.Parent_Object_ID,
    NULL::VARCHAR AS Related_Object_UUID,
    NULL::BIGINT AS Related_Object_ID,
    NULL::VARCHAR AS Related_Object_Name,
    NULL::VARCHAR AS Related_Object_Type,
    NULL::INTEGER AS Related_Z_Order,
    NULL::DOUBLE AS Overlap_Area,
    NULL::DOUBLE AS Overlap_Ratio,
    'Name kommt ' || CAST(d.Duplicate_Count AS VARCHAR) ||
      'x im Layout vor: ' || d.Duplicate_Members AS Detail_Text,
    60 AS Sort_Order
  FROM objects_with_metrics o
  JOIN duplicate_names d
    ON d.Object_UUID = o.Object_UUID
   AND d.File_Name = o.File_Name
  WHERE d.Duplicate_Count > 1

  UNION ALL

  SELECT
    md5('copy-name|' || Object_UUID || '|' || File_Name) AS Finding_ID,
    'Kopierte Objektnamen' AS Issue_Category,
    'Objektname wirkt kopiert' AS Issue_Type,
    'medium' AS Severity,
    Layout_UUID,
    Layout_Name,
    Layout_TO_Name,
    File_Name,
    Layout_ID,
    Object_UUID,
    Object_ID,
    Object_Name,
    Object_Type,
    Abs_Top,
    Abs_Left,
    Abs_Bottom,
    Abs_Right,
    Width,
    Height,
    Z_Order,
    Nesting_Level,
    Parent_Object_ID,
    NULL::VARCHAR AS Related_Object_UUID,
    NULL::BIGINT AS Related_Object_ID,
    NULL::VARCHAR AS Related_Object_Name,
    NULL::VARCHAR AS Related_Object_Type,
    NULL::INTEGER AS Related_Z_Order,
    NULL::DOUBLE AS Overlap_Area,
    NULL::DOUBLE AS Overlap_Ratio,
    'Objektname enthaelt Kopie/Copy-Muster' AS Detail_Text,
    70 AS Sort_Order
  FROM objects_with_metrics
  WHERE regexp_matches(lower(COALESCE(Object_Name, '')), '(copy|kopie|duplikat|duplicate)')

  UNION ALL

  SELECT
    md5('overlap|' || Object_UUID || '|' || Related_Object_UUID || '|' || File_Name) AS Finding_ID,
    'Überlappungen' AS Issue_Category,
    'Objekte liegen übereinander' AS Issue_Type,
    CASE WHEN Overlap_Ratio >= 0.75 THEN 'high' ELSE 'medium' END AS Severity,
    Layout_UUID,
    Layout_Name,
    Layout_TO_Name,
    File_Name,
    Layout_ID,
    Object_UUID,
    Object_ID,
    Object_Name,
    Object_Type,
    Abs_Top,
    Abs_Left,
    Abs_Bottom,
    Abs_Right,
    Width,
    Height,
    Z_Order,
    Nesting_Level,
    Parent_Object_ID,
    Related_Object_UUID,
    Related_Object_ID,
    Related_Object_Name,
    Related_Object_Type,
    Related_Z_Order,
    CAST(Overlap_Area AS DOUBLE) AS Overlap_Area,
    CAST(Overlap_Ratio AS DOUBLE) AS Overlap_Ratio,
    'Überlappung ' || CAST(ROUND(Overlap_Area, 0) AS VARCHAR) || ' px²; Stapel ' ||
      COALESCE(Object_Name, Object_Type, 'Objekt') || ' (Z=' || COALESCE(CAST(Z_Order AS VARCHAR), '?') || ') / ' ||
      COALESCE(Related_Object_Name, Related_Object_Type, 'Objekt') || ' (Z=' || COALESCE(CAST(Related_Z_Order AS VARCHAR), '?') || ')' AS Detail_Text,
    80 AS Sort_Order
  FROM overlap_pairs
  WHERE Overlap_Area >= 16
    AND Overlap_Ratio >= 0.20
)
SELECT *
FROM findings
WHERE Finding_ID IS NOT NULL;
