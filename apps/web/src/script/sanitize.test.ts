import { describe, expect, it } from 'vitest';
import { sanitizePluginHtml } from './sanitize';

describe('sanitizePluginHtml', () => {
  it('keeps allowed documentation markup', () => {
    const html = '<p class="intro">Text <strong>fett</strong> <a href="https://example.com" title="Quelle">Link</a></p>';

    expect(sanitizePluginHtml(html)).toBe(html);
  });

  it('removes executable tags with their content', () => {
    const html = '<p>vorher</p><script>alert("xss")</script><style>body{display:none}</style><p>nachher</p>';

    expect(sanitizePluginHtml(html)).toBe('<p>vorher</p><p>nachher</p>');
  });

  it('removes event handlers and unsafe URLs', () => {
    const html = '<a href="javascript:alert(1)" onclick="alert(2)" data-plugin-fn="MBS.Test">Doku</a>';

    expect(sanitizePluginHtml(html)).toBe('<a data-plugin-fn="MBS.Test">Doku</a>');
  });

  it('unwraps harmless unknown tags without keeping unsafe attributes', () => {
    const html = '<section onclick="alert(1)"><span data-plugin-component="Math">Inhalt</span></section>';

    expect(sanitizePluginHtml(html)).toBe('<span data-plugin-component="Math">Inhalt</span>');
  });

  it('allows local anchors and mail links', () => {
    const html = '<a href="#beispiel">Abschnitt</a><a href="mailto:test@example.com">Mail</a>';

    expect(sanitizePluginHtml(html)).toBe(html);
  });
});
