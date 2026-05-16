import React, { useEffect, useRef } from 'react';
import type { FieldTokens } from '../script/calcTokens';
import { HighlightRefContext } from '../script/highlightContext';
import { CalcTokenSpan } from './CalcTokenSpan';
import { getUiLanguage, tx } from '../lib/uiLanguage';
import './CustomFunctionViewer.css';
import './FieldViewer.css';

interface FieldViewerProps {
  data: FieldTokens;
  /** Cross-Reference Highlight: Token-Match auf Tokens mit `uuid ∈ Set`. */
  highlightRefUuids?: Set<string> | null;
}

/**
 * Renderer für die Feld-Details. Zeigt die Feld-Metadaten (Tabelle, Typ,
 * Datentyp, Kommentar etc.) als Property-Liste und — falls vorhanden — die
 * Calculation-Formel als Token-Sequenz (analog CustomFunctionViewer).
 *
 * Tokens werden über `CalcTokenSpan` gerendert, identisch zu CustomFunctions:
 * Engine-Funktionen erhalten einen Reference-DB-Tooltip, Field- und CF-Refs
 * werden zu klickbaren Links. Variablen, Plugin-Funktionen und Kommentare
 * bekommen ihre jeweilige Highlight-Klasse.
 */
export const FieldViewer: React.FC<FieldViewerProps> = ({ data, highlightRefUuids }) => {
  const language = getUiLanguage();
  const rootRef = useRef<HTMLDivElement>(null);
  const highlightSig = highlightRefUuids ? Array.from(highlightRefUuids).sort().join(',') : '';
  useEffect(() => {
    if (!highlightSig || !rootRef.current) return;
    const id = requestAnimationFrame(() => {
      const first = rootRef.current?.querySelector('.fm-ref--highlighted');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(id);
  }, [highlightSig]);

  const field = data.field;
  const hasFormula = data.tokens && data.tokens.length > 0;
  const formulaLabel = field?.autoEnterType === 'Calculated'
    ? tx(language, 'Auto-Enter-Berechnung', 'Auto-enter calculation')
    : tx(language, 'Berechnungsformel', 'Calculation formula');

  return (
    <HighlightRefContext.Provider value={highlightRefUuids ?? null}>
      <div ref={rootRef} className="fm-customfunction fm-field" aria-label={tx(language, 'Feld-Details', 'Field details')}>
        <div className="fm-customfunction-header">
          <h2 className="type-detail-heading">
            {field?.table && (
              <span className="fm-field-table">{field.table}::</span>
            )}
            {data.object.name}
          </h2>
          <span className="fm-customfunction-meta">{data.object.file}</span>
        </div>

        {field && (
          <dl className="fm-field-props">
            <dt>{tx(language, 'Feldtyp', 'Field type')}</dt>
            <dd>{field.fieldType ?? '-'}</dd>
            <dt>{tx(language, 'Datentyp', 'Data type')}</dt>
            <dd>{field.dataType ?? '-'}</dd>
            {field.isGlobal && (
              <>
                <dt>Global</dt>
                <dd>{tx(language, 'Ja', 'Yes')}</dd>
              </>
            )}
            {field.maxRepetitions > 1 && (
              <>
                <dt>{tx(language, 'Wiederholungen', 'Repetitions')}</dt>
                <dd>{field.maxRepetitions}</dd>
              </>
            )}
            {field.autoEnterType && (
              <>
                <dt>Auto-Enter</dt>
                <dd>{field.autoEnterType}</dd>
              </>
            )}
            {field.comment && (
              <>
                <dt>{tx(language, 'Kommentar', 'Comment')}</dt>
                <dd className="fm-field-comment">{field.comment}</dd>
              </>
            )}
          </dl>
        )}

        {hasFormula && (
          <div className="fm-field-formula">
            <div className="fm-field-formula-label">{formulaLabel}</div>
            <pre className="fm-customfunction-body">
              <code>
                {data.tokens.map((tok, idx) => (
                  <CalcTokenSpan key={idx} token={tok} />
                ))}
              </code>
            </pre>
          </div>
        )}
      </div>
    </HighlightRefContext.Provider>
  );
};
