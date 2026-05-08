const fs = require('fs');
const path = require('path');
const { LRUCache } = require('lru-cache');
const Database = require('better-sqlite3');

const htmlExtractor = require('./html-extractor');
const pluginDocsConfig = require('../../config/plugin-docs.config');

/**
 * MBS-Source-Adapter
 *
 * Kennt die Verzeichnisstruktur und den SQLite-Index der MBS-Doku. Wandelt
 * einen Funktionsnamen wie "List.AddPrefix" in eine HTML-Datei und delegiert
 * die Extraktion an den generischen html-extractor.
 *
 * Architektur-Hinweis: Der Server läuft in `READ_ONLY`-Modus auf einer
 * Kopie der DuckDB. Hier öffnen wir einen davon unabhängigen SQLite-Reader
 * auf `docs/mbs/docSet.dsidx` (read-only). Kein DuckDB-Touch.
 */

// ─── Cache-Setup ─────────────────────────────────────────────────────────
// Path-Lookup: Funktionsname → HTML-Dateiname (klein, wertvoll)
const pathCache = new LRUCache({
  max: pluginDocsConfig.cacheMaxPaths,
  ttl: pluginDocsConfig.cacheTTL,
});

// Extracted-Doc-Cache: Funktionsname → { short, long, metadata }
const docCache = new LRUCache({
  max: pluginDocsConfig.cacheMaxDocs,
  ttl: pluginDocsConfig.cacheTTL,
});

let dbHandle = null; // better-sqlite3 Database (lazy init)
let dbInitTried = false;
let dbInitError = null;

const SOURCE_ID = 'mbs';

function getMbsConfig() {
  return pluginDocsConfig.sources[SOURCE_ID];
}

function getIndexPath() {
  const cfg = getMbsConfig();
  return path.join(cfg.rootPath, cfg.indexFile);
}

function getDocsDir() {
  const cfg = getMbsConfig();
  return path.join(cfg.rootPath, cfg.docsDir);
}

/**
 * Liefert TRUE, wenn die MBS-Doku verfügbar ist (Verzeichnis existiert,
 * Index-Datei lesbar). Wird beim Server-Start aufgerufen, um die Quelle
 * im Status-Endpoint zu markieren.
 */
function isAvailable() {
  const cfg = getMbsConfig();
  if (!cfg || !cfg.rootPath) return false;
  try {
    const stat = fs.statSync(cfg.rootPath);
    if (!stat.isDirectory()) return false;
    fs.accessSync(getIndexPath(), fs.constants.R_OK);
    fs.accessSync(getDocsDir(), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lazy-init der SQLite-Verbindung. Im Fehlerfall (z.B. Datei fehlt) wird
 * `dbInitError` gesetzt und alle nachfolgenden Lookups werfen einen
 * deklarativen Error mit `code: 'PLUGIN_DOC_NOT_INSTALLED'`.
 */
function getDb() {
  if (dbHandle) return dbHandle;
  if (dbInitTried) {
    if (dbInitError) throw dbInitError;
    return dbHandle;
  }
  dbInitTried = true;

  const indexPath = getIndexPath();
  if (!fs.existsSync(indexPath)) {
    const err = new Error(`MBS-Doku-Index nicht gefunden: ${indexPath}`);
    err.code = 'PLUGIN_DOC_NOT_INSTALLED';
    err.source = SOURCE_ID;
    dbInitError = err;
    throw err;
  }

  try {
    dbHandle = new Database(indexPath, { readonly: true, fileMustExist: true });
    return dbHandle;
  } catch (e) {
    const err = new Error(`SQLite-Index konnte nicht geöffnet werden: ${e.message}`);
    err.code = 'PLUGIN_DOC_NOT_INSTALLED';
    err.source = SOURCE_ID;
    err.cause = e;
    dbInitError = err;
    throw err;
  }
}

/**
 * Resolver: Funktionsname → HTML-Dateiname (z.B. "ListAddPrefix.html").
 * Liefert NULL, wenn nicht im Index.
 */
function resolveDocPath(fnName) {
  const cached = pathCache.get(fnName);
  if (cached !== undefined) return cached;

  const db = getDb();
  const stmt = db.prepare(
    "SELECT path FROM searchIndex WHERE type='Function' AND name = ? LIMIT 1"
  );
  const row = stmt.get(fnName);
  const result = row ? row.path : null;
  pathCache.set(fnName, result);
  return result;
}

/**
 * Liefert bis zu `limit` Funktionsnamen, die als Vorschlag bei einem
 * `PLUGIN_FUNCTION_NOT_FOUND`-Fehler zurückgegeben werden. Strategie:
 *   1) LIKE 'name%' (Präfix-Match, z.B. "List." → "List.AddPrefix" …)
 *   2) ergänzt um LIKE '%name%' (Substring-Match) bis zum Limit.
 */
function suggestFunctions(fnName, limit = 10) {
  const db = getDb();
  const trimmed = String(fnName || '').trim();
  if (!trimmed) return [];

  const prefixStmt = db.prepare(
    "SELECT name FROM searchIndex WHERE type='Function' AND name LIKE ? ORDER BY name LIMIT ?"
  );
  const prefix = prefixStmt.all(`${trimmed}%`, limit).map((r) => r.name);

  if (prefix.length >= limit) return prefix;

  const remaining = limit - prefix.length;
  const seen = new Set(prefix);
  const substringStmt = db.prepare(
    "SELECT name FROM searchIndex WHERE type='Function' AND name LIKE ? AND name NOT LIKE ? ORDER BY name LIMIT ?"
  );
  const substring = substringStmt
    .all(`%${trimmed}%`, `${trimmed}%`, remaining)
    .map((r) => r.name)
    .filter((n) => !seen.has(n));

  return prefix.concat(substring).slice(0, limit);
}

/**
 * Lädt eine Funktion und liefert das Ergebnis als
 * `{ source, function, found, metadata, short, long }` — bereits in der
 * Form, die der Controller direkt durchreichen kann.
 *
 * Wirft Errors mit aussagekräftigem `code` für die bekannten Fehlerfälle:
 *   - PLUGIN_DOC_NOT_INSTALLED     — docs/mbs/ fehlt
 *   - PLUGIN_FUNCTION_NOT_FOUND    — Name nicht im SQLite-Index
 *   - PLUGIN_DOC_FILE_MISSING      — Index zeigt auf nicht vorhandene Datei
 */
function getFunctionDoc(fnName) {
  if (!fnName || typeof fnName !== 'string') {
    const err = new Error('Funktionsname ist leer oder ungültig');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const cached = docCache.get(fnName);
  if (cached) return cached;

  const docPath = resolveDocPath(fnName);
  if (!docPath) {
    const err = new Error(`MBS-Funktion nicht im Index: ${fnName}`);
    err.code = 'PLUGIN_FUNCTION_NOT_FOUND';
    err.source = SOURCE_ID;
    err.suggestions = suggestFunctions(fnName, 10);
    throw err;
  }

  const fullPath = path.join(getDocsDir(), docPath);
  if (!fs.existsSync(fullPath)) {
    const err = new Error(`HTML-Datei zur Funktion ${fnName} fehlt: ${docPath}`);
    err.code = 'PLUGIN_DOC_FILE_MISSING';
    err.source = SOURCE_ID;
    err.docPath = docPath;
    throw err;
  }

  const html = fs.readFileSync(fullPath, 'utf-8');
  const extracted = htmlExtractor.extract(html, { sourceId: SOURCE_ID });
  if (!extracted) {
    const err = new Error(`HTML-Datei konnte nicht geparst werden: ${docPath}`);
    err.code = 'PLUGIN_DOC_FILE_MISSING';
    err.source = SOURCE_ID;
    err.docPath = docPath;
    throw err;
  }

  // Ergänze externe URL aus der Konfiguration
  const cfg = getMbsConfig();
  const result = {
    source: SOURCE_ID,
    function: fnName,
    found: true,
    metadata: {
      ...extracted.metadata,
      url: cfg.externalUrl(fnName),
    },
    short: { format: 'html', content: extracted.short },
    long: { format: 'html', content: extracted.long },
  };

  docCache.set(fnName, result);
  return result;
}

/**
 * Liefert die Kategorien-Liste aus dem SQLite-Index. Mit `withFunctionCounts`
 * wird zusätzlich pro Kategorie die Anzahl Funktionen ermittelt, deren Name
 * mit `<Kategorie>.` beginnt (Component-Präfix-Konvention der MBS-Doku).
 *
 * Rückgabe: Array von `{ name, path, functionCount? }`.
 */
function listCategories({ withFunctionCounts = false } = {}) {
  const db = getDb();
  const stmt = db.prepare(
    "SELECT name, path FROM searchIndex WHERE type='Category' ORDER BY name"
  );
  const rows = stmt.all();

  if (!withFunctionCounts) return rows;

  // Eine einzige aggregierende Query statt N Einzelqueries.
  const countStmt = db.prepare(
    "SELECT substr(name, 1, instr(name, '.') - 1) AS prefix, COUNT(*) AS cnt " +
    "FROM searchIndex WHERE type='Function' AND instr(name, '.') > 0 " +
    "GROUP BY prefix"
  );
  const counts = new Map(countStmt.all().map((r) => [r.prefix, r.cnt]));
  return rows.map((r) => ({ ...r, functionCount: counts.get(r.name) || 0 }));
}

/**
 * Funktionen innerhalb einer Kategorie. Konvention der MBS-Doku: alle
 * Funktionen einer Kategorie tragen den Kategorienamen als Component-Präfix
 * (`List.AddPrefix`, `List.AddValue`, …). Wir prüfen zunächst, ob die
 * Kategorie überhaupt im Index registriert ist (`exists`), und liefern dann
 * die Liste der zugeordneten Funktionen.
 *
 * Rückgabe: `{ exists, total, results: [{ name, path }] }`.
 */
function listFunctionsInCategory(categoryName, { limit = 200, offset = 0 } = {}) {
  const db = getDb();
  const trimmed = String(categoryName || '').trim();
  if (!trimmed) return { exists: false, total: 0, results: [] };

  const catStmt = db.prepare(
    "SELECT name FROM searchIndex WHERE type='Category' AND name = ? LIMIT 1"
  );
  const cat = catStmt.get(trimmed);
  if (!cat) return { exists: false, total: 0, results: [] };

  const pattern = `${trimmed}.%`;
  const totalStmt = db.prepare(
    "SELECT COUNT(*) AS cnt FROM searchIndex WHERE type='Function' AND name LIKE ?"
  );
  const total = totalStmt.get(pattern).cnt;

  const stmt = db.prepare(
    "SELECT name, path FROM searchIndex WHERE type='Function' AND name LIKE ? " +
    "ORDER BY name LIMIT ? OFFSET ?"
  );
  const rows = stmt.all(pattern, limit, offset);
  return { exists: true, total, results: rows };
}

/**
 * Volltextsuche über Funktionsnamen. Strategie analog zu `suggestFunctions`,
 * aber mit konfigurierbarem Limit/Offset und Kennzeichnung des Match-Typs
 * (`prefix` zuerst, dann `substring`).
 *
 * Rückgabe: `{ total, results: [{ name, path, match }] }`.
 */
function searchFunctions(query, { limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const trimmed = String(query || '').trim();
  if (!trimmed) return { total: 0, results: [] };

  // Total: alle Funktionen, die irgendwo den Suchbegriff enthalten.
  const totalStmt = db.prepare(
    "SELECT COUNT(*) AS cnt FROM searchIndex WHERE type='Function' AND name LIKE ?"
  );
  const total = totalStmt.get(`%${trimmed}%`).cnt;
  if (total === 0) return { total: 0, results: [] };

  // Kombinierte Sortierung: erst Präfix-Treffer, dann Substring-Treffer,
  // jeweils alphabetisch. Klassisch in einer Query mit CASE als Sortkey.
  const stmt = db.prepare(
    "SELECT name, path, " +
    "  CASE WHEN name LIKE ? THEN 'prefix' ELSE 'substring' END AS match_type " +
    "FROM searchIndex " +
    "WHERE type='Function' AND name LIKE ? " +
    "ORDER BY CASE WHEN name LIKE ? THEN 0 ELSE 1 END, name " +
    "LIMIT ? OFFSET ?"
  );
  const prefixPattern = `${trimmed}%`;
  const substringPattern = `%${trimmed}%`;
  const rows = stmt.all(
    prefixPattern,
    substringPattern,
    prefixPattern,
    limit,
    offset
  );
  return {
    total,
    results: rows.map((r) => ({ name: r.name, path: r.path, match: r.match_type })),
  };
}

/**
 * Status-Information für /api/plugin-docs Endpoint.
 */
function getStatus() {
  const cfg = getMbsConfig();
  const available = isAvailable();
  const status = {
    id: SOURCE_ID,
    label: cfg.label,
    publisher: cfg.publisher,
    homepage: cfg.homepage,
    available,
    path: cfg.rootPath,
  };

  if (!available) return status;

  // Versions-Info aus .version Datei (sofern vorhanden) auslesen
  try {
    const versionPath = path.join(cfg.rootPath, cfg.versionFile);
    if (fs.existsSync(versionPath)) {
      status.version = fs.readFileSync(versionPath, 'utf-8').trim();
    }
  } catch {
    // ignorierbar
  }

  // Funktion- und Kategorie-Anzahl aus SQLite
  try {
    const db = getDb();
    const countStmt = db.prepare(
      "SELECT type, COUNT(*) AS count FROM searchIndex GROUP BY type"
    );
    const counts = countStmt.all();
    status.counts = counts.reduce((acc, r) => {
      acc[r.type.toLowerCase()] = r.count;
      return acc;
    }, {});
  } catch {
    // ignorierbar — Quelle bleibt available, aber ohne Counts
  }

  return status;
}

/**
 * Cache leeren — z.B. nach Doku-Update durch `install-mbs-docs`.
 */
function clearCaches() {
  pathCache.clear();
  docCache.clear();
}

module.exports = {
  id: SOURCE_ID,
  isAvailable,
  getStatus,
  getFunctionDoc,
  suggestFunctions,
  resolveDocPath,
  listCategories,
  listFunctionsInCategory,
  searchFunctions,
  clearCaches,
};
