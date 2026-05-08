const pluginDocsService = require('../services/plugin-docs');
const { buildSuccess } = require('../utils/response-builder');

/**
 * Plugin-Docs-Controller
 *
 * Versorgt das Frontend mit Plugin-Funktions-Dokumentation. Endpoints:
 *
 *   GET /api/plugin-docs                       — Liste verfügbarer Quellen
 *   GET /api/plugin-docs/:source               — Status einer Quelle
 *   GET /api/plugin-docs/:source/_categories             — Kategorien einer Quelle
 *   GET /api/plugin-docs/:source/_categories/:category    — Funktionen einer Kategorie
 *   GET /api/plugin-docs/:source/_search?q=…              — Volltextsuche über Funktionsnamen
 *   GET /api/plugin-docs/:source/:function     — Doku einer Funktion
 *
 * Query-Parameter beim Funktion-Lookup:
 *   level   = short | long | both           (Default: both)
 *   format  = json  | html  | markdown      (Default: json)
 *
 * Bei `format=html` wird der HTML-Inhalt direkt als `text/html` ausgeliefert
 * (kein JSON-Wrapper) — geeignet für `<iframe srcdoc>` oder direkt-DOM-Embed.
 * Markdown ist im MVP nicht implementiert und liefert HTTP 501.
 */

const VALID_LEVELS = new Set(['short', 'long', 'both']);
const VALID_FORMATS = new Set(['json', 'html', 'markdown']);

/**
 * Mapped Error-Codes auf HTTP-Status. Codes ohne Mapping gehen als 500.
 */
const ERROR_STATUS = {
  PLUGIN_DOC_SOURCE_UNKNOWN: 404,
  PLUGIN_FUNCTION_NOT_FOUND: 404,
  PLUGIN_CATEGORY_NOT_FOUND: 404,
  PLUGIN_DOC_FILE_MISSING: 500,
  PLUGIN_DOC_NOT_INSTALLED: 503,
  VALIDATION_ERROR: 400,
  NOT_IMPLEMENTED: 501,
};

function sendErrorResponse(res, code, message, extra = {}) {
  const status = ERROR_STATUS[code] || 500;
  const payload = {
    success: false,
    error: { code, message, details: extra.details || {} },
  };
  if (extra.suggestions) payload.data = { suggestions: extra.suggestions };
  if (extra.hint) payload.error.hint = extra.hint;
  return res.status(status).json(payload);
}

/**
 * GET /api/plugin-docs — Liste aller registrierten Quellen mit Status.
 */
function listSources(req, res, next) {
  try {
    const sources = pluginDocsService.listSources();
    res.json(buildSuccess({ sources }));
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/plugin-docs/:source — Status einer einzelnen Quelle.
 */
function getSourceStatus(req, res, next) {
  try {
    const { source } = req.params;
    const status = pluginDocsService.getSourceStatus(source);
    if (!status) {
      return sendErrorResponse(res, 'PLUGIN_DOC_SOURCE_UNKNOWN',
        `Unbekannte Plugin-Doku-Quelle: ${source}`);
    }
    return res.json(buildSuccess(status));
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/plugin-docs/:source/_categories — Kategorien-Liste einer Quelle.
 *
 * Query-Parameter:
 *   withCounts = true | false  (Default: false)
 *     Wenn `true`, wird pro Kategorie die Anzahl zugeordneter Funktionen
 *     ergänzt. Erfordert eine zusätzliche Aggregat-Query — etwas teurer,
 *     aber für Übersichtsseiten meist erwünscht.
 */
function getCategories(req, res, next) {
  try {
    const { source } = req.params;
    // Query-Keys werden global zu lowercase normalisiert (s. query-normalizer.js)
    const withCounts = String(req.query.withcounts || '').toLowerCase() === 'true';

    let categories;
    try {
      categories = pluginDocsService.listCategories(source, { withFunctionCounts: withCounts });
    } catch (e) {
      if (e.code === 'PLUGIN_DOC_SOURCE_UNKNOWN') {
        return sendErrorResponse(res, e.code, `Unbekannte Plugin-Doku-Quelle: ${source}`);
      }
      if (e.code === 'PLUGIN_DOC_NOT_INSTALLED') {
        return sendErrorResponse(res, e.code,
          `Plugin-Doku '${source}' ist nicht installiert.`,
          { hint: 'Installiere die Doku via Skill `install-mbs-docs` oder setze PLUGIN_DOCS_MBS_PATH in .env' });
      }
      if (e.code === 'NOT_IMPLEMENTED') {
        return sendErrorResponse(res, e.code, e.message);
      }
      throw e;
    }

    return res.json(buildSuccess({
      source,
      count: categories.length,
      categories,
    }));
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/plugin-docs/:source/_categories/:category — Funktionen einer Kategorie.
 *
 * Query-Parameter:
 *   limit   Default 200, Max 1000.
 *   offset  Default 0.
 *
 * Antwort enthält pro Funktion einen `docUrl`-Link, den das Frontend direkt
 * fetchen kann (`GET /api/plugin-docs/:source/:function`).
 */
function getCategoryFunctions(req, res, next) {
  try {
    const { source, category } = req.params;
    const limit = clampInt(req.query.limit, { def: 200, min: 1, max: 1000 });
    const offset = clampInt(req.query.offset, { def: 0, min: 0, max: 100000 });

    let result;
    try {
      result = pluginDocsService.listFunctionsInCategory(source, category, { limit, offset });
    } catch (e) {
      if (e.code === 'PLUGIN_DOC_SOURCE_UNKNOWN') {
        return sendErrorResponse(res, e.code, `Unbekannte Plugin-Doku-Quelle: ${source}`);
      }
      if (e.code === 'PLUGIN_CATEGORY_NOT_FOUND') {
        return sendErrorResponse(res, e.code,
          `Kategorie '${category}' nicht in Quelle '${source}' gefunden.`);
      }
      if (e.code === 'PLUGIN_DOC_NOT_INSTALLED') {
        return sendErrorResponse(res, e.code,
          `Plugin-Doku '${source}' ist nicht installiert.`,
          { hint: 'Installiere die Doku via Skill `install-mbs-docs` oder setze PLUGIN_DOCS_MBS_PATH in .env' });
      }
      if (e.code === 'NOT_IMPLEMENTED') {
        return sendErrorResponse(res, e.code, e.message);
      }
      throw e;
    }

    const functions = result.results.map((r) => ({
      name: r.name,
      path: r.path,
      docUrl: `/api/plugin-docs/${encodeURIComponent(source)}/${r.name}`,
    }));

    return res.json(buildSuccess({
      source,
      category,
      total: result.total,
      count: functions.length,
      limit,
      offset,
      functions,
    }));
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/plugin-docs/:source/_search?q=… — Volltextsuche über Funktionsnamen.
 *
 * Query-Parameter:
 *   q       Suchbegriff (Pflicht). Mindestens 1 Zeichen.
 *   limit   Default 50, Max 500.
 *   offset  Default 0.
 */
function searchFunctions(req, res, next) {
  try {
    const { source } = req.params;
    const q = String(req.query.q || '').trim();
    const limit = clampInt(req.query.limit, { def: 50, min: 1, max: 500 });
    const offset = clampInt(req.query.offset, { def: 0, min: 0, max: 100000 });

    if (!q) {
      return sendErrorResponse(res, 'VALIDATION_ERROR',
        'Query-Parameter `q` fehlt oder ist leer.');
    }

    let result;
    try {
      result = pluginDocsService.searchFunctions(source, q, { limit, offset });
    } catch (e) {
      if (e.code === 'PLUGIN_DOC_SOURCE_UNKNOWN') {
        return sendErrorResponse(res, e.code, `Unbekannte Plugin-Doku-Quelle: ${source}`);
      }
      if (e.code === 'PLUGIN_DOC_NOT_INSTALLED') {
        return sendErrorResponse(res, e.code,
          `Plugin-Doku '${source}' ist nicht installiert.`,
          { hint: 'Installiere die Doku via Skill `install-mbs-docs` oder setze PLUGIN_DOCS_MBS_PATH in .env' });
      }
      if (e.code === 'NOT_IMPLEMENTED') {
        return sendErrorResponse(res, e.code, e.message);
      }
      throw e;
    }

    return res.json(buildSuccess({
      source,
      query: q,
      total: result.total,
      count: result.results.length,
      limit,
      offset,
      results: result.results,
    }));
  } catch (err) {
    return next(err);
  }
}

/**
 * Begrenzt einen Integer-Query-Parameter zwischen `min` und `max` und liefert
 * `def` zurück, wenn der Wert fehlt oder nicht parsebar ist.
 */
function clampInt(raw, { def, min, max }) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

/**
 * GET /api/plugin-docs/:source/:function — Doku einer Funktion.
 */
function getFunctionDoc(req, res, next) {
  try {
    const { source, function: fnName } = req.params;

    // Query-Parameter validieren
    const level = (req.query.level || 'both').toLowerCase();
    const format = (req.query.format || 'json').toLowerCase();

    if (!VALID_LEVELS.has(level)) {
      return sendErrorResponse(res, 'VALIDATION_ERROR',
        `Ungültiger level-Parameter: '${level}'. Erlaubt: short, long, both`);
    }
    if (!VALID_FORMATS.has(format)) {
      return sendErrorResponse(res, 'VALIDATION_ERROR',
        `Ungültiger format-Parameter: '${format}'. Erlaubt: json, html, markdown`);
    }
    if (format === 'markdown') {
      return sendErrorResponse(res, 'NOT_IMPLEMENTED',
        'Markdown-Format ist im MVP noch nicht implementiert. Bitte format=json oder format=html verwenden.');
    }

    let doc;
    try {
      doc = pluginDocsService.getFunctionDoc(source, fnName);
    } catch (e) {
      // Bekannte Fehler-Codes mit aussagekräftigen Bodies
      if (e.code === 'PLUGIN_DOC_NOT_INSTALLED') {
        return sendErrorResponse(res, e.code,
          `Plugin-Doku '${source}' ist nicht installiert.`,
          { hint: 'Installiere die Doku via Skill `install-mbs-docs` oder setze PLUGIN_DOCS_MBS_PATH in .env' });
      }
      if (e.code === 'PLUGIN_DOC_SOURCE_UNKNOWN') {
        return sendErrorResponse(res, e.code,
          `Unbekannte Plugin-Doku-Quelle: ${source}`);
      }
      if (e.code === 'PLUGIN_FUNCTION_NOT_FOUND') {
        return sendErrorResponse(res, e.code,
          `Funktion '${fnName}' nicht in Quelle '${source}' gefunden.`,
          { suggestions: e.suggestions || [] });
      }
      if (e.code === 'PLUGIN_DOC_FILE_MISSING') {
        return sendErrorResponse(res, e.code,
          `HTML-Datei für Funktion '${fnName}' fehlt: ${e.docPath}`);
      }
      throw e;
    }

    // Anwendungs-spezifische Filterung nach `level`
    const filtered = {
      source: doc.source,
      function: doc.function,
      found: doc.found,
      metadata: doc.metadata,
    };
    if (level === 'short' || level === 'both') filtered.short = doc.short;
    if (level === 'long' || level === 'both') filtered.long = doc.long;

    // Format-Switch
    if (format === 'html') {
      const html = renderHtmlBody(filtered, level);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    return res.json(buildSuccess(filtered));
  } catch (err) {
    return next(err);
  }
}

/**
 * Stellt für `format=html` einen kombinierten HTML-Body zusammen, je nach
 * gewünschtem Detailgrad. Frontends, die nur ein Snippet brauchen, können
 * `level=short` oder `level=long` nutzen — dann ist der Output direkt
 * verwendbar. Bei `level=both` wird zuerst Kurz-, dann Langtext geliefert.
 */
function renderHtmlBody(doc, level) {
  const parts = [];
  if ((level === 'short' || level === 'both') && doc.short) {
    parts.push(doc.short.content);
  }
  if (level === 'both' && doc.short && doc.long) {
    // Trenner zwischen Kurz und Lang einfügen
    parts.push('<hr data-plugin-doc-divider="true" />');
  }
  if ((level === 'long' || level === 'both') && doc.long) {
    parts.push(doc.long.content);
  }
  return parts.join('\n');
}

module.exports = {
  listSources,
  getSourceStatus,
  getCategories,
  getCategoryFunctions,
  searchFunctions,
  getFunctionDoc,
};
