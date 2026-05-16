import React from 'react';
import type { ViewMode } from '../script/types';
import { getUiLanguage, tx } from '../lib/uiLanguage';

export type FilterStyle = 'dim' | 'hide';

interface ScriptViewerHeaderProps {
  stepCount: number;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  filterStyle: FilterStyle;
  onFilterStyleChange: (style: FilterStyle) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onCollapseMultiline: () => void;
}

const MODE_OPTIONS: Array<{ id: ViewMode; label: string; labelEn: string }> = [
  { id: 'normal',           label: 'Normal', labelEn: 'Normal' },
  { id: 'compact',          label: 'Kompakt', labelEn: 'Compact' },
  { id: 'comments-only',    label: 'Nur Kommentare', labelEn: 'Comments only' },
  { id: 'control-only',     label: 'Nur Kontrollstrukturen', labelEn: 'Control structures only' },
  { id: 'subscript-only',   label: 'Nur Sub-Aufrufe', labelEn: 'Subscripts only' },
  { id: 'assignments-only', label: 'Nur Zuweisungen', labelEn: 'Assignments only' },
  { id: 'executive-only',   label: 'Nur ausführbarer Code', labelEn: 'Executable code only' },
];

export const ScriptViewerHeader: React.FC<ScriptViewerHeaderProps> = ({
  stepCount,
  mode,
  onModeChange,
  filterStyle,
  onFilterStyleChange,
  onExpandAll,
  onCollapseAll,
  onCollapseMultiline,
}) => {
  const filterDisabled = mode === 'normal';
  const language = getUiLanguage();
  return (
    <div className="fm-script-header">
      <h2 className="type-detail-heading fm-script-title">
        {tx(language, 'Script-Text', 'Script text')} <span className="fm-script-count">({stepCount} {tx(language, 'Schritte', 'steps')})</span>
      </h2>
      <div className="fm-script-actions">
        <label className="fm-script-mode">
          <span className="fm-script-mode-label">{tx(language, 'Ansicht:', 'View:')}</span>
          <select
            value={mode}
            onChange={(e) => onModeChange(e.target.value as ViewMode)}
            aria-label="View-Mode"
          >
            {MODE_OPTIONS.map(opt => (
              <option key={opt.id} value={opt.id}>{tx(language, opt.label, opt.labelEn)}</option>
            ))}
          </select>
        </label>
        <div
          className={`fm-filter-toggle${filterDisabled ? ' fm-filter-toggle--disabled' : ''}`}
          role="radiogroup"
          aria-label={tx(language, 'Filter-Stil', 'Filter style')}
          aria-disabled={filterDisabled}
          title={filterDisabled
            ? tx(language, 'Nur relevant, wenn ein Filter aktiv ist', 'Only relevant when a filter is active')
            : tx(language, 'Gefilterte Zeilen: dimmen oder ausblenden', 'Dim or hide filtered lines')}
        >
          <button
            type="button"
            role="radio"
            aria-checked={filterStyle === 'dim'}
            className={filterStyle === 'dim' ? 'is-active' : ''}
            onClick={() => onFilterStyleChange('dim')}
            disabled={filterDisabled}
          >
            {tx(language, 'Dimmen', 'Dim')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={filterStyle === 'hide'}
            className={filterStyle === 'hide' ? 'is-active' : ''}
            onClick={() => onFilterStyleChange('hide')}
            disabled={filterDisabled}
          >
            {tx(language, 'Ausblenden', 'Hide')}
          </button>
        </div>
        <div className="fm-script-fold-buttons">
          <button type="button" onClick={onExpandAll} title={tx(language, 'Alle aufklappen', 'Expand all')}>
            ⌄ {tx(language, 'Alle auf', 'Expand all')}
          </button>
          <button type="button" onClick={onCollapseAll} title={tx(language, 'Alle zuklappen', 'Collapse all')}>
            ⌃ {tx(language, 'Alle zu', 'Collapse all')}
          </button>
          <button type="button" onClick={onCollapseMultiline} title={tx(language, 'Mehrzeilige Calcs zuklappen', 'Collapse multiline calculations')}>
            ⌃ {tx(language, 'Mehrzeilige', 'Multiline')}
          </button>
        </div>
      </div>
    </div>
  );
};
