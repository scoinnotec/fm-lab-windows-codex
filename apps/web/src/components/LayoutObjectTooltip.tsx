import { useLayoutEffect, useRef, useState } from 'react';
import type { LayoutObject } from '../hooks/useLayoutData';

type Props = {
  object: LayoutObject;
  x: number;
  y: number;
};

const MAX_VISIBLE_LINES = 4;
const CURSOR_OFFSET_X = 14;
const CURSOR_OFFSET_Y = 18;
const VIEWPORT_MARGIN = 12;

/**
 * Begrenzt mehrzeilige Hide-/Tooltip-Calc-Texte auf eine sichtbare Zeilenanzahl —
 * sehr lange Bedingungen würden den Hover-Tooltip sonst die ganze Bildschirmhöhe füllen.
 */
function clampLines(text: string): { display: string; truncated: boolean } {
  const lines = text.split('\n');
  if (lines.length <= MAX_VISIBLE_LINES) {
    return { display: text, truncated: false };
  }
  return {
    display: lines.slice(0, MAX_VISIBLE_LINES).join('\n'),
    truncated: true,
  };
}

export function LayoutObjectTooltip({ object, x, y }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + CURSOR_OFFSET_X, top: y + CURSOR_OFFSET_Y });

  // Edge-Detection: Tooltip an die andere Seite des Cursors flippen, wenn er rechts/unten
  // aus dem Viewport ragt.
  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    let left = x + CURSOR_OFFSET_X;
    let top = y + CURSOR_OFFSET_Y;

    if (left + rect.width > viewportW - VIEWPORT_MARGIN) {
      left = x - rect.width - CURSOR_OFFSET_X;
    }
    if (top + rect.height > viewportH - VIEWPORT_MARGIN) {
      top = y - rect.height - CURSOR_OFFSET_Y;
    }
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;

    setPos({ left, top });
  }, [x, y, object.object_uuid]);

  const hide = object.hide_text ? clampLines(object.hide_text) : null;
  const tooltip = object.tooltip_text ? clampLines(object.tooltip_text) : null;

  return (
    <div
      ref={ref}
      role="tooltip"
      className="layout-object-tooltip"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="layout-tooltip-row">
        <span className="layout-tooltip-key">Type</span>
        <span className="layout-tooltip-val layout-tooltip-type">{object.object_type}</span>
      </div>
      {object.object_name && (
        <div className="layout-tooltip-row">
          <span className="layout-tooltip-key">Name</span>
          <span className="layout-tooltip-val">{object.object_name}</span>
        </div>
      )}
      {object.field_name && (
        <div className="layout-tooltip-row">
          <span className="layout-tooltip-key">Field</span>
          <span className="layout-tooltip-val layout-tooltip-link">{object.field_name}</span>
        </div>
      )}
      {object.script_name && (
        <div className="layout-tooltip-row">
          <span className="layout-tooltip-key">Script</span>
          <span className="layout-tooltip-val layout-tooltip-link">{object.script_name}</span>
        </div>
      )}
      {tooltip && (
        <div className="layout-tooltip-block">
          <div className="layout-tooltip-key">Tooltip</div>
          <pre className="layout-tooltip-pre">{tooltip.display}</pre>
          {tooltip.truncated && (
            <div className="layout-tooltip-hint">…(weitere Zeilen — Detail öffnen)</div>
          )}
        </div>
      )}
      {hide && (
        <div className="layout-tooltip-block">
          <div className="layout-tooltip-key">Hide</div>
          <pre className="layout-tooltip-pre">{hide.display}</pre>
          {hide.truncated && (
            <div className="layout-tooltip-hint">…(weitere Zeilen — Detail öffnen)</div>
          )}
        </div>
      )}
      {object.has_conditional_fmt && (
        <div className="layout-tooltip-row">
          <span className="layout-tooltip-key">Conditional Formatting</span>
          <span className="layout-tooltip-val">vorhanden</span>
        </div>
      )}
    </div>
  );
}
