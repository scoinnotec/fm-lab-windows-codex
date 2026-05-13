/**
 * HTML-Extractor für Plugin-Funktions-Dokumentation
 *
 * Marker-basierter Schnitt-Algorithmus. Findet die relevanten Inhaltsbereiche
 * über eindeutige Anker-Pattern statt einer großen Regex über das ganze
 * Dokument. Robust gegen verschachteltes HTML in Examples-Blöcken.
 *
 * Aufbau einer MBS-Doku-Seite (vereinfacht):
 *
 *   <table class="HelpNavigation">…</table>            ❌ Top-Navigation
 *   <h2 translate="no">FunktionName</h2>               ✅ START
 *   <p>Kurzbeschreibung</p>
 *   <table>Component/Version/Plattform-Matrix</table>
 *   <div id="PrototypeSmall">Signatur</div>
 *   <h3>Parameters</h3><table>…</table>
 *   <h3>Result</h3><p>…</p>
 *   ─── Schnitt KURZTEXT │ LANGTEXT ───
 *   <h3>Description</h3>…
 *   <h3>Examples</h3>…
 *   <h3>See also</h3>…
 *   <h3>Release notes</H3>                             ❌ Langtext-Ende
 *   <h3>Example Databases</h3>                         ❌
 *   <h3>Blog Entries</h3>                              ❌
 *   <div id="FMMLinks">…</div>                         ❌
 *   <p>This function checks for a license.</p>        ⚠️ separat extrahieren
 *   <P><a>PrevFunc</a> - <a>NextFunc</a></P>          ❌
 *   <div id=askquestion>…</div>                        ❌
 */

// ─── START-Marker ────────────────────────────────────────────────────────
const START_RE = /<h2\s+translate="no">/i;

// ─── Marker für KURZTEXT-Ende (in Reihenfolge der Priorität) ─────────────
// Erstes Match nach <h2> gewinnt.
const SHORT_END_MARKERS = [
  /<h3\s+lang="en">\s*Description\s*<\/h3>/i,
  /<h3\s+lang="en">\s*Examples\s*<\/h3>/i,
  /<h3\s+lang="en">\s*See\s+also\s*<\/h3>/i,
];

// ─── Marker für LANGTEXT-Ende ────────────────────────────────────────────
// Beachte: </H3> mit Großbuchstaben, kommt im MBS-HTML so vor.
const LONG_END_MARKERS = [
  /<h3\s+lang="en">\s*Release\s+notes\s*<\/H3>/i,
  /<h3\s+lang="en">\s*Example\s+Databases\s*<\/h3>/i,
  /<h3\s+lang="en">\s*Blog\s+Entries\s*<\/h3>/i,
  /<div\s+id="FMMLinks"/i,
  /<p[^>]*>\s*This\s+function\s+(?:checks\s+for\s+a\s+license|is\s+free\s+to\s+use|requires)/i,
  /<br\s+clear=all\s*\/?\s*>/i,
  /<div\s+id=["']?askquestion/i,
];

// ─── Lizenz-Hinweis (separat extrahiert, an Langtext angehängt) ──────────
const LICENSE_RE = /<p[^>]*>\s*This\s+function\s+(?:checks\s+for\s+a\s+license|is\s+free\s+to\s+use|requires[^<]+?)\.\s*<\/p>/i;
const LICENSE_KIND_RE = /This\s+function\s+(checks\s+for\s+a\s+license|is\s+free\s+to\s+use|requires[^.<]+)/i;

/**
 * Findet den Index des ersten Match einer Marker-Liste — alle Pattern werden
 * geprüft, der niedrigste (= früheste) gefundene Index gewinnt. Marker, die
 * nicht matchen oder vor `from` liegen, werden ignoriert.
 *
 * Liefert `defaultIdx` (i.d.R. html.length), wenn keiner matched.
 */
function firstMarkerIndex(html, markers, from, defaultIdx) {
  let best = defaultIdx;
  for (const re of markers) {
    re.lastIndex = 0;
    const slice = html.slice(from);
    const m = slice.match(re);
    if (!m) continue;
    const idx = from + slice.indexOf(m[0]);
    if (idx >= 0 && idx < best) best = idx;
  }
  return best;
}

/**
 * Entfernt eingebettete <textarea …>…</textarea>-Blöcke. Diese enthalten in
 * der MBS-Doku rohe FM-XML-Snippets, die im Frontend nicht als Text
 * auftauchen sollen, aber via "Copy XML"-Button bedient werden — letzterer
 * funktioniert in unserem Frontend ohnehin nicht.
 */
function stripTextareas(html) {
  return html.replace(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi, '');
}

/**
 * Entfernt die zwei "Copy"-Buttons aus den Beispiel-Boxen (Frontend kann
 * diese nicht ausführen — `copy.js` und Click-Handler sind nicht geladen).
 */
function stripCopyButtons(html) {
  return html.replace(/<div class="copy-buttons">[\s\S]*?<\/div>/gi, '');
}

/**
 * Entfernt den More/Less-Toggle-Link aus PrototypeSmall, da das zugehörige
 * `moreless.js` im Frontend nicht geladen ist.
 */
function stripMoreLessLinks(html) {
  return html.replace(/<a[^>]+onClick="(?:more|less)Documentation\(\);?"[^>]*>[^<]*<\/a>/gi, '');
}

/** Pattern für nicht-funktionale .html-Slugs in MBS-Doku-Links (Navigation,
 *  Versionen, Plattform-Filter, Statistiken). Anchors auf solche Ziele
 *  werden zu Plain-Text degradiert, weil im Frontend kein sinnvolles
 *  Navigations-Ziel existiert. `component_` ist hier NICHT enthalten —
 *  das wird vorher als data-plugin-component annotiert. */
const NON_FN_SLUG_RE = /^(?:newinversion|all|index|new|mac|win|linux|ios|server|client|cross|stat|deprecated|old|filemaker-magazin|blog-entries)/i;

/** Escape für HTML-Attribut-Werte (Funktionsname, Component-Name). */
function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Annotiert navigierbare Anchor-Elemente mit `data-plugin-*`-Markern und
 * entfernt Anchors ohne Navigations-Bedeutung. Nach diesem Schritt gilt
 * für das ausgelieferte HTML: "Hat `data-plugin-*` → Command. Hat
 * `https://` → externer Link. Sonst kein Link." (siehe PRD-HTML-Marker).
 *
 * Schritte:
 *  1. Component-Anchor (`href="component_<Name>.html"`)
 *     → `<a href="#" data-plugin-source data-plugin-component="<Name>">`
 *  2. Version-Anchor (`Class=version` oder `href="newinversion*.html"`)
 *     → Wrapper entfernt, Inhalt als Plain-Text.
 *  3. Funktions-Anchor (`href="<Slug>.html"`)
 *     → `data-plugin-fn=<innerer Text>` (= fachlicher Funktionsname mit Punkt).
 *  4. Bare `href="#"`-Anchors ohne `data-plugin-*`-Marker → Wrapper entfernt.
 */
function annotateNavigationMarkers(html, sourceId) {
  // 1) Component-Anchor — innerer Text ist der Component-Name (z.B. "List").
  html = html.replace(
    /<a\s+href="component_([A-Za-z0-9_-]+)\.html"([^>]*)>([\s\S]*?)<\/a>/gi,
    (_m, slug, rest, inner) => {
      const compName = inner.replace(/<[^>]+>/g, '').trim() || slug;
      // `translate="no"` aus dem Original-MBS-HTML ist in einer Click-Anchor
      // zwecks Browser-Übersetzung gedacht — für unseren Frontend-Konsum
      // irrelevant, wir entfernen es zugunsten konsistenter Marker.
      const cleanRest = rest.replace(/\s+translate="[^"]*"/gi, '');
      return `<a href="#" data-plugin-source="${escapeAttr(sourceId)}" `
        + `data-plugin-component="${escapeAttr(compName)}"${cleanRest}>${inner}</a>`;
    }
  );

  // 2a) Version-Anchor mit `Class=version` (mit/ohne Quotes) — Wrapper raus.
  html = html.replace(
    /<a\b[^>]*\bClass\s*=\s*(?:"version"|'version'|version)\b[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, inner) => inner
  );

  // 2b) Falls noch ein <a href="newinversionXY.html"> übrig ist (ohne
  //     Class=version), ebenfalls Wrapper entfernen.
  html = html.replace(
    /<a\s+href="newinversion[A-Za-z0-9_-]*\.html"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, inner) => inner
  );

  // 3) Funktions-Anchors (.html-Links) — innerer Text ist der fachliche
  //    Funktionsname mit Punkt-Notation (z.B. "List.AddPostfix").
  html = html.replace(
    /<a\s+href="([A-Za-z0-9_-]+)\.html"([^>]*)>([\s\S]*?)<\/a>/gi,
    (_m, slug, rest, inner) => {
      // Sonstige Navigations-Slugs ohne Lookup-Wert (Plattform-Filter,
      // Statistik-Seiten, etc.) → Wrapper entfernen.
      if (NON_FN_SLUG_RE.test(slug)) return inner;
      const fnName = inner.replace(/<[^>]+>/g, '').trim();
      if (!fnName) return inner;
      return `<a href="#" data-plugin-source="${escapeAttr(sourceId)}" `
        + `data-plugin-fn="${escapeAttr(fnName)}"${rest}>${inner}</a>`;
    }
  );

  // 4) Restliche `href="#"`-Anchors ohne Marker → Wrapper entfernen. Anchors
  //    mit `data-plugin-*`-Attribut bleiben; externe https://-Links sind
  //    nie auf `#` gesetzt und somit nicht betroffen.
  html = html.replace(
    /<a\s+([^>]*?)href="#"([^>]*)>([\s\S]*?)<\/a>/gi,
    (m, before, after, inner) => {
      const attrs = `${before} ${after}`;
      if (/\bdata-plugin-[a-z]+\s*=/i.test(attrs)) return m;
      return inner;
    }
  );

  return html;
}

// ─── Metadata-Parser ─────────────────────────────────────────────────────

/**
 * Extrahiert die Metadaten-Tabelle (Component, Version, Plattformen).
 *
 * Schaut nach der Component-Spalte (`<a href="component_…" translate="no">`)
 * und der Version-Spalte (`<a href="newinversion…" Class=version>`). Die
 * Plattformen erkennen wir an "Yes"/"No" pro Spalte — die Reihenfolge ist
 * stabil: macOS, Windows, Linux, Server, iOS.
 */
function parseMetadataTable(html) {
  const meta = {
    component: null,
    version: null,
    platforms: {
      macOS: null,
      windows: null,
      linux: null,
      server: null,
      iOS: null,
    },
  };

  const componentMatch = html.match(
    /<a\s+href="component_([^"]+)\.html"[^>]*translate="no">\s*([^<]+?)\s*<\/a>/i
  );
  if (componentMatch) meta.component = componentMatch[2].trim();

  const versionMatch = html.match(
    /<a\s+href="newinversion\d+\.html"\s+Class=version[^>]*>\s*([^<]+?)\s*<\/a>/i
  );
  if (versionMatch) meta.version = versionMatch[1].trim();

  // Plattform-Zellen: "Function works on …" oder "Function does not work on …".
  // Wir matchen alle title-Attribute der grau-Zellen mit Yes/No.
  const platformOrder = ['macOS', 'windows', 'linux', 'server', 'iOS'];
  const cellRe = /<td\s+Class=grau\s+title="Function\s+(works|does\s+not\s+work)\s+(?:on|in)[^"]*"[^>]*>\s*[^A-Za-z]*\s*(Yes|No)\s*<\/td>/gi;
  let m;
  let i = 0;
  while ((m = cellRe.exec(html)) !== null && i < platformOrder.length) {
    meta.platforms[platformOrder[i]] = m[2] === 'Yes';
    i += 1;
  }

  return meta;
}

/**
 * Extrahiert den Funktionsnamen aus dem ersten <h2 translate="no">.
 */
function parseFunctionName(html) {
  const m = html.match(/<h2\s+translate="no">\s*([^<]+?)\s*<\/h2>/i);
  return m ? m[1].trim() : null;
}

/**
 * Extrahiert die Kurz-Signatur aus PrototypeSmall — mit Decode der
 * &quot;-Entities, sodass der Konsument einen direkt lesbaren String erhält.
 */
function parseSignature(html) {
  const m = html.match(/<div\s+id="PrototypeSmall"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return null;
  // Inneren Text: &quot; → ", &nbsp; → ' ', dann den More-Link entfernen.
  let raw = m[1]
    .replace(/<a\b[^>]*onClick="moreDocumentation[^"]*"[^>]*>[^<]*<\/a>/gi, '')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .trim();
  return raw || null;
}

/**
 * Extrahiert den Result-Text (erstes <p> nach <h3>Result</h3>).
 */
function parseResult(html) {
  const m = html.match(
    /<h3\s+lang="en">\s*Result\s*<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/i
  );
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, '').trim();
}

/**
 * Klassifiziert den Lizenz-Hinweis aus dem `<p>This function …</p>`-Absatz.
 */
function parseLicense(html) {
  const m = html.match(LICENSE_KIND_RE);
  if (!m) return null;
  const txt = m[1].toLowerCase().trim();
  if (txt.startsWith('checks for a license')) return 'checks_for_license';
  if (txt.startsWith('is free to use')) return 'free';
  if (txt.startsWith('requires')) return `requires:${m[1].replace(/^requires\s+/i, '').trim()}`;
  return txt;
}

// ─── Haupt-API ───────────────────────────────────────────────────────────

/**
 * Extrahiert Kurz- und Langtext sowie Metadaten aus einer MBS-HTML-Seite.
 *
 * @param {string} html  Vollständiger Seitentext.
 * @param {object} opts
 * @param {string} opts.sourceId  Quellen-ID für Link-Rewriting (z.B. "mbs").
 * @returns {{short:string, long:string, metadata:object}|null}
 */
function extract(html, { sourceId = 'mbs' } = {}) {
  if (typeof html !== 'string' || html.length === 0) return null;

  const startIdx = html.search(START_RE);
  if (startIdx < 0) return null;

  const shortEndIdx = firstMarkerIndex(html, SHORT_END_MARKERS, startIdx, html.length);
  const longEndIdx = firstMarkerIndex(html, LONG_END_MARKERS, startIdx, html.length);

  let shortHtml = html.slice(startIdx, shortEndIdx);
  let longHtml = html.slice(startIdx, longEndIdx);

  // Lizenz-Absatz nachträglich an den Langtext anhängen
  const licenseMatch = html.match(LICENSE_RE);
  if (licenseMatch) {
    longHtml += `\n${licenseMatch[0]}`;
  }

  // Bereinigung: Textareas, Copy-Buttons, Toggle-Links
  shortHtml = stripMoreLessLinks(stripCopyButtons(stripTextareas(shortHtml)));
  longHtml = stripMoreLessLinks(stripCopyButtons(stripTextareas(longHtml)));

  // Anchors mit Navigations-Bedeutung markieren (siehe PRD HTML-Marker).
  shortHtml = annotateNavigationMarkers(shortHtml, sourceId);
  longHtml = annotateNavigationMarkers(longHtml, sourceId);

  // Metadaten — auf das Original-HTML, nicht auf die getrimmten Slices
  const metaTable = parseMetadataTable(html);
  // Synthetische PluginComponent-UUID für Cross-Navigation aus der Plugin-Doku
  // (PRD prd_pseudo_object_types_filter.md §5). Folgt der Konvention aus
  // sql/create_universal_catalogs.sql: md5('PluginComponent::MBS::' || component).
  // Heute nur MBS unterstützt (sourceId='mbs'); bei zukünftigen Container-Plugins
  // muss der Source-Prefix entsprechend gemappt werden.
  let componentUuid = null;
  if (metaTable.component && sourceId === 'mbs') {
    const crypto = require('crypto');
    componentUuid = crypto
      .createHash('md5')
      .update(`PluginComponent::MBS::${metaTable.component}`)
      .digest('hex');
  }
  const metadata = {
    name: parseFunctionName(html),
    component: metaTable.component,
    componentUuid,
    version: metaTable.version,
    platforms: metaTable.platforms,
    signature: parseSignature(html),
    result: parseResult(html),
    license: parseLicense(html),
  };

  return {
    short: shortHtml.trim(),
    long: longHtml.trim(),
    metadata,
  };
}

module.exports = {
  extract,
  // Für Tests / Debugging
  _internals: {
    stripTextareas,
    stripCopyButtons,
    stripMoreLessLinks,
    annotateNavigationMarkers,
    parseMetadataTable,
    parseSignature,
    parseResult,
    parseLicense,
    firstMarkerIndex,
  },
};
