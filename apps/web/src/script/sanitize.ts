// Whitelist-basierter Sanitizer für Plugin-Doku-HTML.
// Quelle ist unsere eigene REST-API, die das HTML aus der MBS-Plugin-Doku
// liefert — wir vertrauen ihr grundsätzlich, entfernen aber defensiv alles
// was Skripts oder Event-Handler ausführen könnte.
//
// Strategie: Browser parst HTML in einem detached Document, dann walken wir
// den Tree und entfernen verbotene Tags/Attribute. Kein Regex-Sanitizing.

const ALLOWED_TAGS = new Set([
  'A', 'B', 'BR', 'CODE', 'DIV', 'EM', 'H1', 'H2', 'H3', 'H4', 'I',
  'LI', 'OL', 'P', 'PRE', 'SPAN', 'STRONG', 'TABLE', 'TBODY', 'TD',
  'TH', 'THEAD', 'TR', 'UL',
]);

const ALLOWED_ATTRS = new Set([
  'href', 'title', 'lang', 'class',
  // unsere eigenen Marker-Attribute aus der API
  'data-plugin-fn', 'data-plugin-component', 'data-plugin-source',
]);

function sanitizeNode(node: Element) {
  // Disallowed Tags → unwrap (Inhalt behalten, Tag entfernen)
  if (!ALLOWED_TAGS.has(node.tagName)) {
    const parent = node.parentNode;
    if (parent) {
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
    }
    return;
  }

  // Attribute filtern
  const attrs = Array.from(node.attributes);
  for (const attr of attrs) {
    const name = attr.name.toLowerCase();
    if (!ALLOWED_ATTRS.has(name)) {
      node.removeAttribute(attr.name);
      continue;
    }
    if (name === 'href') {
      const value = attr.value.trim();
      // Nur http/https/mailto erlauben — javascript: etc. blocken
      if (!/^(https?:|mailto:|#)/i.test(value)) {
        node.removeAttribute(attr.name);
      }
    }
  }

  // Rekursiv kindern (Kopie, weil wir während des Walks ändern können)
  const children = Array.from(node.children);
  for (const child of children) sanitizeNode(child);
}

export function sanitizePluginHtml(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const children = Array.from(tpl.content.children);
  for (const c of children) sanitizeNode(c);
  return tpl.innerHTML;
}
