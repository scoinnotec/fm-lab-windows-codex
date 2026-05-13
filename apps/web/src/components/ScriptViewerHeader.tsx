import React from 'react';
import type { ViewMode } from '../script/types';

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

const MODE_OPTIONS: Array<{ id: ViewMode; label: string }> = [
  { id: 'normal',           label: 'Normal' },
  { id: 'compact',          label: 'Kompakt' },
  { id: 'comments-only',    label: 'Nur Kommentare' },
  { id: 'control-only',     label: 'Nur Kontrollstrukturen' },
  { id: 'subscript-only',   label: 'Nur Sub-Aufrufe' },
  { id: 'assignments-only', label: 'Nur Zuweisungen' },
  { id: 'executive-only',   label: 'Nur ausführbarer Code' },
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
  return (
    <div className="fm-script-header">
      <h2 className="type-detail-heading fm-script-title">
        Script-Text <span className="fm-script-count">({stepCount} Schritte)</span>
      </h2>
      <div className="fm-script-actions">
        <label className="fm-script-mode">
          <span className="fm-script-mode-label">Ansicht:</span>
          <select
            value={mode}
            onChange={(e) => onModeChange(e.target.value as ViewMode)}
            aria-label="View-Mode"
          >
            {MODE_OPTIONS.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </label>
        <div
          className={`fm-filter-toggle${filterDisabled ? ' fm-filter-toggle--disabled' : ''}`}
          role="radiogroup"
          aria-label="Filter-Stil"
          aria-disabled={filterDisabled}
          title={filterDisabled
            ? 'Nur relevant, wenn ein Filter aktiv ist'
            : 'Gefilterte Zeilen: dimmen oder ausblenden'}
        >
          <button
            type="button"
            role="radio"
            aria-checked={filterStyle === 'dim'}
            className={filterStyle === 'dim' ? 'is-active' : ''}
            onClick={() => onFilterStyleChange('dim')}
            disabled={filterDisabled}
          >
            Dimmen
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={filterStyle === 'hide'}
            className={filterStyle === 'hide' ? 'is-active' : ''}
            onClick={() => onFilterStyleChange('hide')}
            disabled={filterDisabled}
          >
            Ausblenden
          </button>
        </div>
        <div className="fm-script-fold-buttons">
          <button type="button" onClick={onExpandAll} title="Alle aufklappen">
            ⌄ Alle auf
          </button>
          <button type="button" onClick={onCollapseAll} title="Alle zuklappen">
            ⌃ Alle zu
          </button>
          <button type="button" onClick={onCollapseMultiline} title="Mehrzeilige Calcs zuklappen">
            ⌃ Mehrzeilige
          </button>
        </div>
      </div>
    </div>
  );
};
