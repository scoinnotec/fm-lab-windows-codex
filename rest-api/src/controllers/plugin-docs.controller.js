const pluginDocsService = require('../services/plugin-docs');
const helpService = require('../services/help.service');
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

/**
 * GET /api/plugin-docs/:source/:function/page — Vollständige HTML-Seite für
 * eine Plugin-Funktion. Analog zur Claris-Help (`/api/reference/help/...`):
 * gleicher Theme-Switcher, gleiche Light-/Dark-Mode-Logik, ohne Sprachschalter.
 *
 * Im Gegensatz zu `?format=html` (liefert nur ein Body-Fragment für Embed/iframe)
 * ist das hier eine eigenständige, in einem neuen Tab öffenbare Seite mit
 * Header, Inhalt und Footer-Link zur externen Quelle.
 */
function getFunctionPage(req, res, next) {
  try {
    const { source, function: fnName } = req.params;

    let doc;
    try {
      doc = pluginDocsService.getFunctionDoc(source, fnName);
    } catch (e) {
      if (e.code === 'PLUGIN_DOC_NOT_INSTALLED') {
        return sendErrorResponse(res, e.code,
          `Plugin-Doku '${source}' ist nicht installiert.`,
          { hint: 'Installiere die Doku via Skill `install-mbs-docs` oder setze PLUGIN_DOCS_MBS_PATH in .env' });
      }
      if (e.code === 'PLUGIN_DOC_SOURCE_UNKNOWN') {
        return sendErrorResponse(res, e.code, `Unbekannte Plugin-Doku-Quelle: ${source}`);
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

    // Inhalt zusammensetzen — bei MBS gibt es Kurz- und Langform; wir
    // bevorzugen Lang, fallback auf Kurz, im Worst Case nichts.
    const parts = [];
    if (doc.long && doc.long.content) parts.push(doc.long.content);
    else if (doc.short && doc.short.content) parts.push(doc.short.content);
    const body = parts.join('\n') || '<p><em>Keine Doku-Inhalte gefunden.</em></p>';

    const html = renderPluginDocPage({
      source,
      doc,
      body: rewritePluginDocLinks(body, source),
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(html);
  } catch (err) {
    return next(err);
  }
}

/**
 * Wrappt einen Plugin-Doku-Body in eine vollständige HTML-Seite mit globaler
 * Header-Leiste (Title links + Theme-Toggle rechts) und Light-/Dark-Variablen.
 * Reuse der Theme-Helper aus `help.service` sorgt für identisches Look-and-Feel
 * mit der Claris-Help-Auslieferung.
 *
 * Innerhalb des Body-Wrappers steht ein zweiter, kompakter Sub-Header mit
 * Funktionsname, Component, Version und externem Doku-Link — der Top-Header
 * trägt nur die Sektions-Headline ("MBS Plugin-Hilfe").
 */
function renderPluginDocPage({ source, doc, body }) {
  const meta = doc.metadata || {};
  const fnTitle = escapeHtml(meta.name || doc.function);
  // Component zeigt auf die Kategorie-Übersichts-Page — von dort aus erreicht
  // der User alle Funktionen derselben Komponente.
  const component = meta.component
    ? `<a class="fm-plugin-doc-component" href="${categoryPageUrl(source, meta.component)}">${escapeHtml(meta.component)}</a>`
    : '';
  const version = meta.version ? `<span class="fm-plugin-doc-version">v${escapeHtml(meta.version)}</span>` : '';
  const sig = meta.signature ? `<code class="fm-plugin-doc-signature">${escapeHtml(meta.signature)}</code>` : '';
  const externalLink = meta.url
    ? `<a class="fm-plugin-doc-extlink" href="${escapeHtml(meta.url)}" target="_blank" rel="noopener noreferrer">Externe Doku öffnen ↗</a>`
    : '';
  const sectionLabel = source === 'mbs' ? 'MBS Plugin-Hilfe' : `${String(source).toUpperCase()} Plugin-Hilfe`;
  const pageTitle = `${fnTitle} — ${escapeHtml(sectionLabel)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${pageTitle}</title>
${helpService.buildThemeStyles()}
${helpService.buildThemePreHydration()}
<style>
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.55;
    background: #ffffff;
    color: #213547;
  }
  html[data-theme="dark"] body { background: #16191f; color: #e6e8ec; }
  .fm-plugin-doc-subheader {
    border-bottom: 1px solid #e0e0e0;
    padding-bottom: 0.8rem;
    margin-bottom: 1.4rem;
  }
  html[data-theme="dark"] .fm-plugin-doc-subheader { border-bottom-color: #303640; }
  .fm-plugin-doc-title {
    margin: 0 0 0.3rem;
    font-size: 1.6rem;
  }
  .fm-plugin-doc-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
    font-size: 0.85rem;
    color: #666;
  }
  html[data-theme="dark"] .fm-plugin-doc-meta { color: #a0a4ad; }
  /* Component ist jetzt ein Link auf die Kategorie-Page; wir lassen ihn wie ein
   * Label aussehen (kein blaues Standard-Link-Styling) und zeigen Hover. */
  a.fm-plugin-doc-component {
    font-weight: 600;
    color: inherit;
    text-decoration: none;
  }
  a.fm-plugin-doc-component:hover {
    color: #4a90e2;
    text-decoration: underline;
  }
  html[data-theme="dark"] a.fm-plugin-doc-component:hover { color: #8ab4ff; }
  .fm-plugin-doc-version { opacity: 0.8; }
  .fm-plugin-doc-signature {
    display: block;
    margin-top: 0.7rem;
    padding: 0.45rem 0.7rem;
    background: #f5f5f5;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    font-size: 0.85rem;
    white-space: pre-wrap;
  }
  html[data-theme="dark"] .fm-plugin-doc-signature {
    background: #1f242c;
    border-color: #303640;
  }
  .fm-plugin-doc-extlink {
    margin-left: auto;
    font-size: 0.85rem;
    text-decoration: none;
    color: #4a90e2;
  }
  html[data-theme="dark"] .fm-plugin-doc-extlink { color: #8ab4ff; }
  .fm-plugin-doc-extlink:hover { text-decoration: underline; }
  .fm-plugin-doc-content { font-size: 0.92rem; }
  .fm-plugin-doc-content table { border-collapse: collapse; margin: 0.7rem 0; }
  .fm-plugin-doc-content th,
  .fm-plugin-doc-content td {
    border: 1px solid #ddd;
    padding: 0.35rem 0.6rem;
    text-align: left;
  }
  html[data-theme="dark"] .fm-plugin-doc-content th,
  html[data-theme="dark"] .fm-plugin-doc-content td { border-color: #303640; }
  html[data-theme="dark"] .fm-plugin-doc-content th { background: #1c2027; }
  .fm-plugin-doc-content code,
  .fm-plugin-doc-content pre {
    background: #f5f5f5;
    border: 1px solid #e0e0e0;
    border-radius: 3px;
    padding: 0.05rem 0.3rem;
    font-size: 0.88em;
  }
  html[data-theme="dark"] .fm-plugin-doc-content code,
  html[data-theme="dark"] .fm-plugin-doc-content pre {
    background: #1f242c;
    border-color: #303640;
    color: #e0e6f0;
  }
  .fm-plugin-doc-content pre { padding: 0.6rem 0.8rem; overflow-x: auto; }
</style>
</head>
<body>
${helpService.buildHelpHeader({
  title: sectionLabel,
  titleHref: indexPageUrl(source),
})}
<div class="fm-help-page-body">
  <header class="fm-plugin-doc-subheader">
    <h2 class="fm-plugin-doc-title">${fnTitle}</h2>
    <div class="fm-plugin-doc-meta">
      ${component}${version}${externalLink}
    </div>
    ${sig}
  </header>
  <main class="fm-plugin-doc-content">
${body}
  </main>
</div>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * URL-Builder für die Index-Page einer Plugin-Quelle (Components-Übersicht).
 */
function indexPageUrl(source) {
  return `/api/plugin-docs/${encodeURIComponent(source)}/page`;
}

/**
 * URL-Builder für die Kategorie-Page einer Plugin-Komponente.
 */
function categoryPageUrl(source, category) {
  return `/api/plugin-docs/${encodeURIComponent(source)}/_categories/${encodeURIComponent(category)}/page`;
}

/**
 * URL-Builder für die Funktions-Page einer Plugin-Funktion.
 */
function functionPageUrl(source, fnName) {
  return `/api/plugin-docs/${encodeURIComponent(source)}/${encodeURIComponent(fnName)}/page`;
}

/**
 * Zentrale Section-Label-Auflösung für Plugin-Quellen — wird für Title und
 * Header-Beschriftung verwendet. Aktuell nur 'mbs' bekannt; Fallback ist
 * generischer "<SOURCE> Plugin-Hilfe".
 */
function sourceLabel(source) {
  if (source === 'mbs') return 'MBS Plugin-Hilfe';
  return `${String(source).toUpperCase()} Plugin-Hilfe`;
}

/**
 * Schreibt die `href="#"`-Platzhalter-Links im MBS-Doku-Body um, die der
 * `html-extractor` mit `data-plugin-fn=...` bzw. `data-plugin-component=...`
 * annotiert hat. So funktionieren Cross-Links zwischen Funktionen und
 * Komponenten direkt im Browser, ohne dass wir auf JS angewiesen wären.
 *
 * Bewusst nur in der Page-Auslieferung — im Hover-Popover bleiben die
 * #-Links als sicherer No-Op stehen, damit Klicks im Tooltip nichts navigieren.
 */
function rewritePluginDocLinks(html, source) {
  if (!html) return html;
  // Funktions-Cross-Links: data-plugin-fn="QuickList.Release" → /page-URL.
  // Wir matchen das gesamte <a …>, weil href="#" und data-plugin-fn in
  // beliebiger Reihenfolge stehen können und Quoting variiert.
  let out = html.replace(
    /<a\b([^>]*?)\bdata-plugin-fn=("([^"]+)"|'([^']+)')([^>]*)>/gi,
    (m, before, _q, dq, sq, after) => {
      const fn = dq || sq;
      const newHref = functionPageUrl(source, fn);
      // href= im before/after ersetzen. Wenn keiner vorhanden ist, einen anhängen.
      const merged = (before + after);
      const hadHref = /\bhref=("[^"]*"|'[^']*')/i.test(merged);
      const replaced = merged.replace(/\bhref=("[^"]*"|'[^']*')/i, `href="${newHref}"`);
      const final = hadHref ? replaced : `${replaced} href="${newHref}"`;
      return `<a${final} data-plugin-fn="${escapeHtml(fn)}">`;
    }
  );
  // Component-Cross-Links: data-plugin-component="List" → /_categories/.../page
  out = out.replace(
    /<a\b([^>]*?)\bdata-plugin-component=("([^"]+)"|'([^']+)')([^>]*)>/gi,
    (m, before, _q, dq, sq, after) => {
      const comp = dq || sq;
      const newHref = categoryPageUrl(source, comp);
      const merged = (before + after);
      const hadHref = /\bhref=("[^"]*"|'[^']*')/i.test(merged);
      const replaced = merged.replace(/\bhref=("[^"]*"|'[^']*')/i, `href="${newHref}"`);
      const final = hadHref ? replaced : `${replaced} href="${newHref}"`;
      return `<a${final} data-plugin-component="${escapeHtml(comp)}">`;
    }
  );
  return out;
}

/**
 * GET /api/plugin-docs/:source/_categories/:category/page — HTML-Page mit
 * Liste aller Funktionen einer Komponente. Gleiche Header-Leiste wie die
 * Funktion-Page, Body ist eine alphabetisch sortierte Funktionsliste mit
 * Links auf die jeweilige Funktion-Page.
 */
function getCategoryPage(req, res, next) {
  try {
    const { source, category } = req.params;

    let result;
    try {
      result = pluginDocsService.listFunctionsInCategory(source, category, { limit: 10000, offset: 0 });
    } catch (e) {
      if (e.code === 'PLUGIN_DOC_NOT_INSTALLED') {
        return sendErrorResponse(res, e.code,
          `Plugin-Doku '${source}' ist nicht installiert.`,
          { hint: 'Installiere die Doku via Skill `install-mbs-docs` oder setze PLUGIN_DOCS_MBS_PATH in .env' });
      }
      if (e.code === 'PLUGIN_DOC_SOURCE_UNKNOWN') {
        return sendErrorResponse(res, e.code, `Unbekannte Plugin-Doku-Quelle: ${source}`);
      }
      if (e.code === 'PLUGIN_CATEGORY_NOT_FOUND') {
        return sendErrorResponse(res, e.code,
          `Kategorie '${category}' nicht in Quelle '${source}' gefunden.`,
          { suggestions: e.suggestions || [] });
      }
      throw e;
    }

    const html = renderPluginCategoryPage({ source, category, result });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(html);
  } catch (err) {
    return next(err);
  }
}

/**
 * Wrappt eine Kategorie-Funktionsliste in eine vollständige HTML-Seite.
 * Reuse der Theme-/Header-Helper aus help.service.js für konsistentes Aussehen
 * mit den Funktion- und Claris-Help-Pages.
 */
function renderPluginCategoryPage({ source, category, result }) {
  const sectionLabel = source === 'mbs' ? 'MBS Plugin-Hilfe' : `${String(source).toUpperCase()} Plugin-Hilfe`;
  const catTitle = escapeHtml(category);
  const total = result && Array.isArray(result.results) ? result.results.length : 0;
  const fnList = (result.results || [])
    .map((f) => {
      const name = escapeHtml(f.name);
      const href = functionPageUrl(source, f.name);
      return `<li><a href="${href}">${name}</a></li>`;
    })
    .join('\n');
  const pageTitle = `${catTitle} — ${escapeHtml(sectionLabel)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${pageTitle}</title>
${helpService.buildThemeStyles()}
${helpService.buildThemePreHydration()}
<style>
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.55;
    background: #ffffff;
    color: #213547;
  }
  html[data-theme="dark"] body { background: #16191f; color: #e6e8ec; }
  .fm-plugin-cat-subheader {
    border-bottom: 1px solid #e0e0e0;
    padding-bottom: 0.8rem;
    margin-bottom: 1.4rem;
  }
  html[data-theme="dark"] .fm-plugin-cat-subheader { border-bottom-color: #303640; }
  .fm-plugin-cat-title { margin: 0 0 0.3rem; font-size: 1.6rem; }
  .fm-plugin-cat-meta { font-size: 0.85rem; color: #666; }
  html[data-theme="dark"] .fm-plugin-cat-meta { color: #a0a4ad; }
  .fm-plugin-cat-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 0.25rem 1rem;
  }
  .fm-plugin-cat-list li { padding: 0.15rem 0; }
  .fm-plugin-cat-list a {
    color: #4a90e2;
    text-decoration: none;
    font-size: 0.9rem;
  }
  html[data-theme="dark"] .fm-plugin-cat-list a { color: #8ab4ff; }
  .fm-plugin-cat-list a:hover { text-decoration: underline; }
</style>
</head>
<body>
${helpService.buildHelpHeader({
  title: sectionLabel,
  titleHref: indexPageUrl(source),
})}
<div class="fm-help-page-body">
  <header class="fm-plugin-cat-subheader">
    <h2 class="fm-plugin-cat-title">${catTitle}</h2>
    <div class="fm-plugin-cat-meta">${total} ${total === 1 ? 'Funktion' : 'Funktionen'}</div>
  </header>
  <main>
    <ul class="fm-plugin-cat-list">
${fnList}
    </ul>
  </main>
</div>
</body>
</html>`;
}

/**
 * GET /api/plugin-docs/:source/page — Startseite der Plugin-Hilfe mit
 * alphabetisch sortierter Liste aller Components (Kategorien). Jede Kategorie
 * verlinkt auf ihre Kategorie-Page mit Funktionsliste.
 */
function getIndexPage(req, res, next) {
  try {
    const { source } = req.params;

    let categories;
    try {
      categories = pluginDocsService.listCategories(source, { withFunctionCounts: true });
    } catch (e) {
      if (e.code === 'PLUGIN_DOC_NOT_INSTALLED') {
        return sendErrorResponse(res, e.code,
          `Plugin-Doku '${source}' ist nicht installiert.`,
          { hint: 'Installiere die Doku via Skill `install-mbs-docs` oder setze PLUGIN_DOCS_MBS_PATH in .env' });
      }
      if (e.code === 'PLUGIN_DOC_SOURCE_UNKNOWN') {
        return sendErrorResponse(res, e.code, `Unbekannte Plugin-Doku-Quelle: ${source}`);
      }
      if (e.code === 'NOT_IMPLEMENTED') {
        return sendErrorResponse(res, e.code, e.message);
      }
      throw e;
    }

    const html = renderPluginIndexPage({ source, categories });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(html);
  } catch (err) {
    return next(err);
  }
}

/**
 * Wrappt die Components-Liste einer Plugin-Quelle in eine vollständige
 * HTML-Seite. Reuse der Theme-/Header-Helper aus help.service.js für
 * konsistentes Aussehen mit Funktion- und Kategorie-Pages.
 */
function renderPluginIndexPage({ source, categories }) {
  const sectionLabel = sourceLabel(source);
  const total = Array.isArray(categories) ? categories.length : 0;
  const totalFns = Array.isArray(categories)
    ? categories.reduce((sum, c) => sum + (Number(c.functionCount) || 0), 0)
    : 0;
  const list = (categories || [])
    .map((c) => {
      const name = escapeHtml(c.name);
      const href = categoryPageUrl(source, c.name);
      const cnt = Number(c.functionCount) || 0;
      return `<li><a href="${href}">${name}</a> <span class="fm-plugin-idx-cnt">(${cnt})</span></li>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Components — ${escapeHtml(sectionLabel)}</title>
${helpService.buildThemeStyles()}
${helpService.buildThemePreHydration()}
<style>
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.55;
    background: #ffffff;
    color: #213547;
  }
  html[data-theme="dark"] body { background: #16191f; color: #e6e8ec; }
  .fm-plugin-idx-subheader {
    border-bottom: 1px solid #e0e0e0;
    padding-bottom: 0.8rem;
    margin-bottom: 1.4rem;
  }
  html[data-theme="dark"] .fm-plugin-idx-subheader { border-bottom-color: #303640; }
  .fm-plugin-idx-title { margin: 0 0 0.3rem; font-size: 1.6rem; }
  .fm-plugin-idx-meta { font-size: 0.85rem; color: #666; }
  html[data-theme="dark"] .fm-plugin-idx-meta { color: #a0a4ad; }
  .fm-plugin-idx-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.25rem 1rem;
  }
  .fm-plugin-idx-list li { padding: 0.15rem 0; }
  .fm-plugin-idx-list a {
    color: #4a90e2;
    text-decoration: none;
    font-size: 0.9rem;
  }
  html[data-theme="dark"] .fm-plugin-idx-list a { color: #8ab4ff; }
  .fm-plugin-idx-list a:hover { text-decoration: underline; }
  .fm-plugin-idx-cnt {
    color: #999;
    font-size: 0.78rem;
  }
  html[data-theme="dark"] .fm-plugin-idx-cnt { color: #6e747f; }
</style>
</head>
<body>
${helpService.buildHelpHeader({
  title: sectionLabel,
  titleHref: indexPageUrl(source),
})}
<div class="fm-help-page-body">
  <header class="fm-plugin-idx-subheader">
    <h2 class="fm-plugin-idx-title">Components</h2>
    <div class="fm-plugin-idx-meta">${total} ${total === 1 ? 'Component' : 'Components'} · ${totalFns} ${totalFns === 1 ? 'Funktion' : 'Funktionen'} insgesamt</div>
  </header>
  <main>
    <ul class="fm-plugin-idx-list">
${list}
    </ul>
  </main>
</div>
</body>
</html>`;
}

module.exports = {
  listSources,
  getSourceStatus,
  getCategories,
  getCategoryFunctions,
  searchFunctions,
  getFunctionDoc,
  getFunctionPage,
  getCategoryPage,
  getIndexPage,
};
