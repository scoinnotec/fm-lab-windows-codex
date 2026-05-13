/**
 * Aggregations-Helper für Pseudo-Token-Listen-Endpoints.
 *
 * PRD prd_pseudo_object_types_filter.md §7.4: Baut SQL-Snippets für
 *   - ?withUsage=true   → usage_count je Token (Aggregation aus StepsForScripts/ObjectLinks)
 *   - ?withCategory=true → category/category_id Live-Join aus ref-Schema bzw. CSV
 *   - ?category=A,B,C   → WHERE-Clause-Filter
 *   - ?sort=usage|name|category → ORDER BY
 * sowie:
 *   - /api/list/categories?type=… → Category-Summary mit token_count + total_usage
 *
 * Conventions:
 *   - ref-Schema ist via ATTACH bereits READ_ONLY angebunden (database.js).
 *   - data/mbs_component_exceptions.csv wird per read_csv() bei PluginFunction-Joins gelesen.
 *     Lookup-Pfad ist relativ zum REST-API-CWD; falls notwendig setzt environment.js den CWD.
 *   - PluginComponent ist KEIN Pseudo-Token-Typ — es hat keine Category über sich,
 *     unterstützt aber ?withUsage (zwei-stufige Aggregation über groups_into+calls_pluginfunction).
 */

const path = require('path');

// Repo-Root, damit read_csv() den CSV-Pfad robust auflöst.
// __dirname = rest-api/src/services → drei Ebenen nach oben.
const REPO_ROOT = path.resolve(__dirname, '../../..');
const MBS_CSV_PATH = path.join(REPO_ROOT, 'data', 'mbs_component_exceptions.csv');
// DuckDB read_csv() versteht absolute Pfade direkt; Pfad-Literal in SQL einbetten.
function csvPathLiteral() {
  return `'${MBS_CSV_PATH.replace(/'/g, "''")}'`;
}

/**
 * Erlaubte Pseudo-Token-Typen für die Inline-Filter (Categories + Usage).
 * Spiegelt PSEUDO_TOKEN_TYPES in constants.js — bewusst dupliziert, um
 * Zirkular-Imports zu vermeiden.
 */
const PSEUDO_TOKEN_TYPES = ['ScriptStepType', 'BuiltinFunction', 'PluginFunction'];
const USAGE_TYPES = [...PSEUDO_TOKEN_TYPES, 'PluginComponent'];

/* ============================================================
 * USAGE-AGGREGATION
 * ============================================================
 * Liefert pro Pseudo-Typ ein SQL-Snippet, das eine CTE `usage_agg`
 * mit Spalten (Object_UUID, usage_count) baut, plus den passenden
 * JOIN-Hinweis für die Basis-Query.
 */

/**
 * Baut die `usage_agg`-CTE für einen Pseudo-Typ.
 * @param {string} dbType - 'ScriptStepType' | 'BuiltinFunction' | 'PluginFunction' | 'PluginComponent'
 * @returns {string|null} SQL-Snippet (CTE-Body) oder null wenn nicht unterstützt.
 */
function buildUsageCTE(dbType) {
  switch (dbType) {
    case 'ScriptStepType':
      // Autoritative Quelle: StepsForScripts.Step_Name (kein ObjectLinks-Spiegelung).
      return `
        usage_agg AS (
          SELECT
            md5('ScriptStepType::' || s.Step_Name) AS Object_UUID,
            COUNT(*) AS usage_count
          FROM StepsForScripts s
          WHERE s.Step_Name IS NOT NULL AND s.Step_Name != ''
          GROUP BY s.Step_Name
        )
      `;

    case 'BuiltinFunction':
      return `
        usage_agg AS (
          SELECT
            ol.Target_UUID AS Object_UUID,
            COUNT(*) AS usage_count
          FROM ObjectLinks ol
          WHERE ol.Link_Role = 'calls_function'
          GROUP BY ol.Target_UUID
        )
      `;

    case 'PluginFunction':
      return `
        usage_agg AS (
          SELECT
            ol.Target_UUID AS Object_UUID,
            COUNT(*) AS usage_count
          FROM ObjectLinks ol
          WHERE ol.Link_Role = 'calls_pluginfunction'
          GROUP BY ol.Target_UUID
        )
      `;

    case 'PluginComponent':
      // Zwei-Stufen-Aggregation: groups_into bringt PluginFunctions
      // einer Component zusammen; calls_pluginfunction zählt deren Aufrufer.
      return `
        usage_agg AS (
          SELECT
            gi.Target_UUID AS Object_UUID,
            COUNT(call.Source_UUID) AS usage_count
          FROM ObjectLinks gi
          LEFT JOIN ObjectLinks call
            ON call.Target_UUID = gi.Source_UUID
           AND call.Link_Role = 'calls_pluginfunction'
          WHERE gi.Link_Role = 'groups_into'
          GROUP BY gi.Target_UUID
        )
      `;

    default:
      return null;
  }
}

/* ============================================================
 * CATEGORY-ANREICHERUNG (Live-Join, kein Storage)
 * ============================================================
 * Liefert pro Pseudo-Token-Typ eine CTE `cat_agg(Object_UUID, category, category_id, is_get_subparam)`.
 * Für Typen ohne Reference-DB-Match bleibt category = NULL (UI rendert "Sonstige").
 */

function buildCategoryCTE(dbType, refAttached) {
  // Wenn die Reference-DB nicht attached ist, liefern wir konsistent NULL.
  if (!refAttached && (dbType === 'ScriptStepType' || dbType === 'BuiltinFunction')) {
    return `
      cat_agg AS (
        SELECT
          oc.Object_UUID,
          NULL::VARCHAR AS category,
          NULL::INTEGER AS category_id,
          FALSE         AS is_get_subparam
        FROM ObjectCatalog oc
        WHERE oc.Object_Type = '${dbType}'
      )
    `;
  }

  switch (dbType) {
    case 'ScriptStepType':
      return `
        cat_agg AS (
          SELECT
            oc.Object_UUID,
            ssc.category_name_en AS category,
            ssc.category_id      AS category_id,
            FALSE                AS is_get_subparam
          FROM ObjectCatalog oc
          LEFT JOIN ref.script_step_name_lookup ssn
            ON ssn.lookup_name = oc.Object_Name AND ssn.is_primary = 1
          LEFT JOIN ref.script_steps ss
            ON ss.step_id = ssn.step_id
          LEFT JOIN ref.script_steps_categories ssc
            ON ssc.category_id = ss.category_id
          WHERE oc.Object_Type = 'ScriptStepType'
        )
      `;

    case 'BuiltinFunction':
      // Drei Fälle:
      //   1) Tokens mit Wrapper 'Get(...)' → direkt Category 7 'Get Functions'
      //      (Reference-DB-Lookup würde fehlschlagen, weil ref-Schreibweise
      //       `Get ( ... )` mit Leerzeichen ist — PRD §6.3.2).
      //   2) Andere Tokens → normaler Lookup über function_name_lookup.
      //      Ausnahme: nackte Get-Sub-Parameter (z.B. 'DesktopPfad', 'SystemDatum')
      //      sind XML-Parser-Artefakte aus Get(...)-Argumenten; die Reference-DB
      //      ordnet sie der Get-Funktions-Familie zu (is_get_function=1).
      //      Wir blenden ihre Category aus, damit der Get-Functions-Bucket
      //      nicht aufgebläht wird (PRD §3.1 erwartet genau 71 Get-Sub-Parameter).
      //   3) Tokens ohne Match → category = NULL (UI rendert "Sonstige").
      return `
        cat_agg AS (
          SELECT
            oc.Object_UUID,
            CASE
              WHEN oc.Object_Name LIKE 'Get(%)' THEN 'Get Functions'
              WHEN f.is_get_function = 1 THEN NULL  -- bare Get-arg-Tokens ausblenden
              ELSE fc.category_name
            END AS category,
            CASE
              WHEN oc.Object_Name LIKE 'Get(%)' THEN 7
              WHEN f.is_get_function = 1 THEN NULL
              ELSE fc.category_id
            END AS category_id,
            (oc.Object_Name LIKE 'Get(%)') AS is_get_subparam
          FROM ObjectCatalog oc
          LEFT JOIN ref.function_name_lookup fnl
            ON fnl.lookup_name = oc.Object_Name
           AND fnl.is_primary = 1
          LEFT JOIN ref.functions f
            ON f.function_id = fnl.function_id
          LEFT JOIN ref.function_categories fc
            ON fc.category_id = f.category_id
          WHERE oc.Object_Type = 'BuiltinFunction'
        )
      `;

    case 'PluginFunction':
      // Component-Anreicherung aus CSV + Default-Heuristik.
      return `
        cat_agg AS (
          WITH mbs_map AS (
            SELECT Funktionsname AS function_name, Component AS component_name
            FROM read_csv(${csvPathLiteral()}, header=true)
          )
          SELECT
            oc.Object_UUID,
            CASE
              WHEN oc.Object_Name LIKE 'MBS::%'
                THEN COALESCE(
                  cm.component_name,
                  split_part(regexp_replace(oc.Object_Name, '^MBS::', ''), '.', 1)
                )
              ELSE NULL
            END AS category,
            NULL::INTEGER AS category_id,
            FALSE         AS is_get_subparam
          FROM ObjectCatalog oc
          LEFT JOIN mbs_map cm
            ON cm.function_name = regexp_replace(oc.Object_Name, '^MBS::', '')
          WHERE oc.Object_Type = 'PluginFunction'
        )
      `;

    default:
      return null;
  }
}

/* ============================================================
 * LIST QUERY BUILDER
 * ============================================================
 * Kombiniert Basis-Liste mit optionaler Usage- und Category-Anreicherung
 * sowie Category-Filter und Sortierung.
 */

/**
 * Erzeugt eine Liste mit allen optionalen Aggregations-Schichten.
 *
 * @param {string} dbType
 * @param {Object} opts
 * @param {string} [opts.file]          - File-Name-Filter
 * @param {boolean} [opts.withUsage]
 * @param {boolean} [opts.withCategory]
 * @param {string[]} [opts.categories]  - Category-Filter (mehrwertig, OR-verknüpft)
 * @param {string} [opts.sort]          - 'usage' | 'name' | 'category'
 * @param {number} [opts.limit]
 * @param {boolean} [opts.refAttached]
 * @returns {{ sql: string, params: any[] }}
 */
function buildListQuery(dbType, opts = {}) {
  const {
    file,
    withUsage = false,
    withCategory = false,
    categories = [],
    sort,
    limit = 0,
    refAttached = true,
  } = opts;

  const cteParts = [];
  const selectExtraCols = [];
  const joinExtra = [];
  const whereExtra = [];
  const params = [dbType];

  if (withUsage) {
    cteParts.push(buildUsageCTE(dbType));
    selectExtraCols.push('COALESCE(u.usage_count, 0) AS usage_count');
    joinExtra.push('LEFT JOIN usage_agg u ON u.Object_UUID = oc.Object_UUID');
  }

  // Category-CTE wird auch gebraucht, wenn nur ein Category-Filter aktiv ist
  // (für die WHERE-Clause), nicht nur bei withCategory.
  const needCat = withCategory || categories.length > 0;
  if (needCat && PSEUDO_TOKEN_TYPES.includes(dbType)) {
    cteParts.push(buildCategoryCTE(dbType, refAttached));
    if (withCategory) {
      selectExtraCols.push('c.category AS category');
      selectExtraCols.push('c.category_id AS category_id');
      if (dbType === 'BuiltinFunction') {
        selectExtraCols.push('c.is_get_subparam AS is_get_subparam');
      }
    }
    joinExtra.push('LEFT JOIN cat_agg c ON c.Object_UUID = oc.Object_UUID');

    if (categories.length > 0) {
      // OR-Filter: c.category IN (?, ?, ?)
      const placeholders = categories.map(() => '?').join(', ');
      whereExtra.push(`c.category IN (${placeholders})`);
      params.push(...categories);
    }
  }

  // Reference-Count entfällt für Pseudo-Typen — wir nutzen usage_count.
  // Trotzdem bleibt das Standard-Listen-Schema kompatibel: oc.* wird gespiegelt.
  const ctePrefix = cteParts.length > 0
    ? 'WITH ' + cteParts.filter(Boolean).join(', \n')
    : '';

  let sql = `
    ${ctePrefix}
    SELECT
      oc.*${selectExtraCols.length > 0 ? ',\n      ' + selectExtraCols.join(',\n      ') : ''}
    FROM ObjectCatalog oc
    ${joinExtra.join('\n    ')}
    WHERE oc.Object_Type = ?
  `;

  if (file) {
    sql += ' AND oc.File_Name = ?';
    params.push(file);
  }

  if (whereExtra.length > 0) {
    sql += ' AND ' + whereExtra.join(' AND ');
  }

  sql += '\n    ' + buildSortOrder(sort, withUsage, withCategory, dbType);

  if (limit > 0) {
    sql += ' LIMIT ?';
    params.push(limit);
  }

  return { sql, params };
}

/**
 * Liefert eine sinnvoll typ-spezifische ORDER BY-Klausel.
 * Default für Pseudo-Typen ist 'usage' (häufigste oben).
 */
function buildSortOrder(sort, hasUsage, hasCategory, dbType) {
  const isPseudo = USAGE_TYPES.includes(dbType);
  const effectiveSort = sort || (isPseudo && hasUsage ? 'usage' : 'name');

  switch (effectiveSort) {
    case 'usage':
      if (hasUsage) {
        return 'ORDER BY COALESCE(u.usage_count, 0) DESC, oc.Object_Name ASC';
      }
      return 'ORDER BY oc.Object_Name ASC';

    case 'category':
      if (hasCategory) {
        return 'ORDER BY c.category ASC NULLS LAST, oc.Object_Name ASC';
      }
      return 'ORDER BY oc.Object_Name ASC';

    case 'name':
    default:
      return 'ORDER BY oc.Object_Name ASC';
  }
}

/* ============================================================
 * CATEGORY-SUMMARY (für /api/list/categories Endpoint)
 * ============================================================
 * Aggregiert die in der Lösung vorkommenden Categories eines Pseudo-Typs
 * mit token_count und total_usage. Liefert die Daten-Basis für die
 * Filter-Pillen im Frontend (PRD §7.2, §8.2).
 */

/**
 * Erzeugt die Query für /api/list/categories?type=<dbType>.
 * Liefert: { category, token_count, total_usage } pro Kategorie.
 * NULL-Categories werden als "Sonstige" zusammengefasst (Object_Name='__null__').
 */
function buildCategorySummaryQuery(dbType, refAttached) {
  if (!PSEUDO_TOKEN_TYPES.includes(dbType)) {
    return null;
  }
  const usageCTE = buildUsageCTE(dbType);
  const catCTE = buildCategoryCTE(dbType, refAttached);

  return `
    WITH ${usageCTE}, ${catCTE}
    SELECT
      c.category AS category,
      COUNT(*) AS token_count,
      COALESCE(SUM(u.usage_count), 0) AS total_usage
    FROM ObjectCatalog oc
    JOIN cat_agg c ON c.Object_UUID = oc.Object_UUID
    LEFT JOIN usage_agg u ON u.Object_UUID = oc.Object_UUID
    WHERE oc.Object_Type = '${dbType}'
    GROUP BY c.category
    ORDER BY total_usage DESC NULLS LAST, c.category ASC NULLS LAST
  `;
}

module.exports = {
  PSEUDO_TOKEN_TYPES,
  USAGE_TYPES,
  buildUsageCTE,
  buildCategoryCTE,
  buildListQuery,
  buildSortOrder,
  buildCategorySummaryQuery,
};
