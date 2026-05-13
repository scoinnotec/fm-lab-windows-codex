import React from 'react';
import type { Piece } from '../script/tokenize';
import { tokenizeLine } from '../script/tokenize';
import { collapseStepParameterBreaks } from '../script/normalizeText';
import { RefSpan } from './RefSpan';
import { ScriptStepSpan } from './ScriptStepSpan';
import type { ScriptRef, ScriptLineToken } from '../script/types';

interface ScriptLineContentProps {
  text: string;
  refs?: ScriptRef[];
  folded?: boolean;
  /**
   * Vollständige Line — wenn übergeben und Reference-DB-Felder vorhanden,
   * wird der Step-Name am Anfang in einen ScriptStepSpan mit Popover gewrappt.
   */
  line?: ScriptLineToken;
}


function renderPiece(piece: Piece, key: number): React.ReactNode {
  switch (piece.type) {
    case 'ref':
      return <RefSpan key={key} reference={piece.ref} text={piece.content} />;
    case 'string':
      return (
        <span key={key} className="fm-token fm-token--string">
          {piece.content}
        </span>
      );
    case 'number':
      return (
        <span key={key} className="fm-token fm-token--number">
          {piece.content}
        </span>
      );
    case 'operator':
      return (
        <span key={key} className="fm-token fm-token--operator">
          {piece.content}
        </span>
      );
    case 'text':
    default:
      return <span key={key}>{piece.content}</span>;
  }
}

/**
 * Falls die Zeile einen bekannten Step-Namen am Anfang hat UND Reference-DB-
 * Anreicherung vorliegt, wird der Step-Name aus dem Text geschnitten und
 * separat als ScriptStepSpan (mit Popover) gerendert. Der Rest geht durch
 * den normalen Tokenizer.
 */
function splitStepName(text: string, line?: ScriptLineToken): { head: string | null; rest: string } {
  if (!line || line.kind !== 'step' || !line.stepName || !line.stepDisplayName) {
    return { head: null, rest: text };
  }
  if (text.startsWith(line.stepName)) {
    return { head: line.stepName, rest: text.slice(line.stepName.length) };
  }
  return { head: null, rest: text };
}

/**
 * Rendert den Text einer Skriptzeile mit allen Refs als gefärbte Spans.
 * Multiline-Text wird aufgeteilt, jede Sub-Zeile bekommt ihre eigene Zeile.
 * Wenn `folded` gesetzt ist und der Text mehrzeilig: nur die erste Sub-Zeile
 * rendern, gefolgt von einem `…`-Marker.
 */
export const ScriptLineContent: React.FC<ScriptLineContentProps> = ({ text, refs, folded, line }) => {
  const normalized = collapseStepParameterBreaks(text);
  const subLines = normalized.split(/\r\n|\r|\n/);

  // Step-Name nur auf der ersten Sub-Zeile abspalten (Step-Name steht immer
  // am Anfang, danach kommen Parameter ggf. mehrzeilig).
  const renderFirstSubLine = (sub: string) => {
    const { head, rest } = splitStepName(sub, line);
    const pieces = tokenizeLine(rest, refs);
    return (
      <>
        {head && line && <ScriptStepSpan text={head} line={line} />}
        {pieces.map(renderPiece)}
      </>
    );
  };

  if (subLines.length === 1) {
    return renderFirstSubLine(normalized);
  }
  if (folded) {
    return (
      <>
        {renderFirstSubLine(subLines[0])}
        <span className="fm-fold-ellipsis"> …</span>
      </>
    );
  }
  return (
    <>
      {subLines.map((sub, i) => {
        const inner = i === 0
          ? renderFirstSubLine(sub)
          : tokenizeLine(sub, refs).map(renderPiece);
        return (
          <span
            key={i}
            className={`fm-line-sub${i > 0 ? ' fm-line-sub--cont' : ''}`}
          >
            {inner}
          </span>
        );
      })}
    </>
  );
};
