-- @template_type: report
-- @description: Cross-Reference Back-Lookup — alle Sources im Destination-Container, die das Origin-Objekt referenzieren
-- @params: destination (required, UUID), origin (required, UUID)
-- @author: Marcel
-- @version: 1.0
-- @tags: references, cross-references, highlight
-- @note: PRD prd_cross_references_hilite.md §6.3.
--        Liefert alle Objekt-UUIDs, die sich INNERHALB des Destination-Containers
--        befinden UND einen operationalen Link auf das Origin haben.
--        Container-Logik:
--          • Destination ist ein Layout       → Sources sind LayoutObjects mit parent_layout
--                                                  ODER Layout direkt (z.B. context_table)
--          • Destination ist ein Script       → Sources sind ScriptSteps mit parent_script
--                                                  ODER Script direkt (z.B. calls_script)
--          • Destination ist eine CustomFunction → Sources sind die CF selbst
--          • Sonst                            → nur direkter Link Destination → Origin

WITH destination AS (
  SELECT Object_UUID, Object_Type, Object_Name, File_Name
  FROM ObjectCatalog
  WHERE Object_UUID = getvariable('destination')
  LIMIT 1
),
origin AS (
  SELECT Object_UUID, Object_Type, Object_Name, File_Name
  FROM ObjectCatalog
  WHERE Object_UUID = getvariable('origin')
  LIMIT 1
),
-- Schritt 1: Alle Links, deren Target das Origin ist (operational).
--            Egal von welchem Source — wir filtern danach.
candidate_links AS (
  SELECT
    ol.Source_UUID,
    ol.Source_Type,
    ol.Link_Role
  FROM ObjectLinks ol
  JOIN origin o ON ol.Target_UUID = o.Object_UUID
  WHERE ol.Link_Type = 'operational'
),
-- Schritt 2: Container-Mitgliedschaft prüfen — Logik hängt vom Destination-Typ ab.
--
--   Layout-Container:
--     Nur Container-Kinder (LayoutObjects, parent_layout) zählen. Direkte
--     Layout→Field-Links über `displays_field` sind redundant zu den
--     LayoutObject-Links und würden den Treffer-Counter verdoppeln, weil sie
--     im SVG nicht als separates Objekt sichtbar sind.
--
--   Script / CustomFunction:
--     Token-Container — die Sub-Objekte (ScriptSteps, CF-Tokens) haben keine
--     eigene Sichtbarkeit, sondern werden via Formel-Tokens im Text markiert.
--     Daher: direkter Self-Link Destination→Origin wird als "1 Container-Match"
--     gezählt, repräsentiert die Token-Vorkommen im Text. Die genaue Anzahl
--     erfordert DDR-Chunk-Scan und liefert dieses Template bewusst nicht.
matches AS (
  SELECT
    cl.Source_UUID AS uuid,
    cl.Source_Type AS type,
    cl.Link_Role   AS role,
    oc.Object_Name AS name
  FROM candidate_links cl
  JOIN destination d ON 1=1
  JOIN ObjectCatalog oc ON cl.Source_UUID = oc.Object_UUID
  WHERE
    -- Container-Kinder (Standardfall: Layout → LayoutObjects)
    EXISTS (
      SELECT 1
      FROM ObjectLinks parent
      WHERE parent.Source_UUID = cl.Source_UUID
        AND parent.Target_UUID = d.Object_UUID
        AND parent.Link_Role IN ('parent_layout', 'parent_script', 'parent_object')
    )
    -- Token-Container (Script / CustomFunction): direkter Self-Link zählt.
    OR (
      cl.Source_UUID = d.Object_UUID
      AND d.Object_Type IN ('Script', 'CustomFunction')
    )
)
SELECT DISTINCT uuid, type, role, name
FROM (
  SELECT * FROM matches

  UNION ALL

  -- Pseudo-Typ-Origins (PRD prd_pseudo_object_types_filter.md §6.4):
  -- ScriptStepType + PluginComponent haben keine ObjectLinks-Spiegelung,
  -- daher findet der Standard-Pfad oben sie nicht. Hier matchen wir name-/
  -- Component-basiert auf die konkreten Sub-Knoten im Destination-Container.
  --
  -- Fall 1: Origin = ScriptStepType, Destination = Script
  --   → alle ScriptSteps mit Step_Name = origin.Object_Name innerhalb des Scripts.
  SELECT
    s.Step_UUID            AS uuid,
    'ScriptStep'           AS type,
    'uses_step_type'       AS role,
    s.Step_Name            AS name
  FROM StepsForScripts s
  JOIN origin o      ON o.Object_Type = 'ScriptStepType' AND s.Step_Name = o.Object_Name
  JOIN destination d ON s.Script_UUID = d.Object_UUID    AND d.Object_Type = 'Script'

  UNION ALL

  -- Fall 2: Origin = PluginComponent, Destination = Script / CustomFunction
  --   → alle Container-Kinder (ScriptStep / CF), die eine PluginFunction der
  --     Component aufrufen (zwei-stufig: groups_into × calls_pluginfunction).
  SELECT
    oc.Object_UUID         AS uuid,
    oc.Object_Type         AS type,
    'calls_component'      AS role,
    oc.Object_Name         AS name
  FROM origin o
  JOIN ObjectLinks gi    ON gi.Target_UUID = o.Object_UUID
                        AND gi.Link_Role = 'groups_into'
  JOIN ObjectLinks call  ON call.Target_UUID = gi.Source_UUID
                        AND call.Link_Role = 'calls_pluginfunction'
                        AND call.Link_Type = 'operational'
  JOIN ObjectCatalog oc  ON oc.Object_UUID = call.Source_UUID
  JOIN destination d     ON 1=1
  WHERE o.Object_Type = 'PluginComponent'
    AND (
      -- Sub-Knoten via parent_script/parent_object Link
      EXISTS (
        SELECT 1 FROM ObjectLinks parent
        WHERE parent.Source_UUID = oc.Object_UUID
          AND parent.Target_UUID = d.Object_UUID
          AND parent.Link_Role IN ('parent_layout', 'parent_script', 'parent_object')
      )
      -- Token-Container (Script / CustomFunction): direkter Self-Link
      OR (
        oc.Object_UUID = d.Object_UUID
        AND d.Object_Type IN ('Script', 'CustomFunction')
      )
    )
) all_matches
ORDER BY type, role, name;
