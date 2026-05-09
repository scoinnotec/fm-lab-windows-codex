import { useMemo } from 'react';
import type { LayoutObject } from '../hooks/useLayoutData';
import { fillFor, strokeFor } from './LayoutObjectShape';

type Props = {
  objects: LayoutObject[];
  activeTypes: Set<string>;
  onToggle: (type: string) => void;
  onSetTypes: (types: string[], active: boolean) => void;
  onClear: () => void;
  detailsMode: boolean;
  onToggleDetailsMode: () => void;
};

type Category = {
  label: string;
  types: string[];
};

// Filter-Kategorien — sechs Gruppen, semantisch nach FileMaker-Verhalten getrennt.
// `Viewer` (vorm. Spezial) bündelt nicht-tabellenartige Anzeige-Container; `Controls`
// die echten interaktiven Container-Typen, `Groups` separat für reine Layout-Gruppierungen.
const CATEGORIES: Category[] = [
  {
    label: 'Input',
    types: [
      'Edit Box', 'Drop-down List', 'Pop-up Menu', 'Radio Button Set',
      'Checkbox Set', 'Drop-down Calendar', 'Concealed Edit Box',
    ],
  },
  { label: 'Display',  types: ['Text', 'Graphic'] },
  { label: 'Viewer',   types: ['Container', 'Web Viewer'] },
  { label: 'Action',   types: ['Button', 'Grouped Button', 'Button Bar', 'Popover Button'] },
  { label: 'Controls', types: ['Portal', 'Panel', 'Slide Control', 'Tab Control'] },
  { label: 'Groups',   types: ['Group'] },
  { label: 'Graphic',  types: ['Rectangle', 'Line', 'Oval', 'Rounded Rectangle'] },
];

type GroupActive = 'none' | 'partial' | 'all';

function groupActivation(types: string[], activeTypes: Set<string>): GroupActive {
  let activeCount = 0;
  for (const t of types) if (activeTypes.has(t)) activeCount++;
  if (activeCount === 0) return 'none';
  if (activeCount === types.length) return 'all';
  return 'partial';
}

export function LayoutTypeFilter({
  objects,
  activeTypes,
  onToggle,
  onSetTypes,
  onClear,
  detailsMode,
  onToggleDetailsMode,
}: Props) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of objects) m.set(o.object_type, (m.get(o.object_type) ?? 0) + 1);
    return m;
  }, [objects]);

  const hasAnyActive = activeTypes.size > 0;

  return (
    <div className="layout-type-filter">
      {CATEGORIES.map(cat => {
        // Im aktuellen Layout vorhandene Typen — leere Gruppen ganz ausblenden,
        // damit z.B. „Web Viewer" nicht in jedem Layout auftaucht.
        const visible = cat.types.filter(t => (counts.get(t) ?? 0) > 0);
        if (visible.length === 0) return null;

        if (!detailsMode) {
          // Stufe 1: nur ein Gruppen-Pille pro Kategorie. Toggle wirkt auf alle Typen
          // der Gruppe gleichzeitig — Anzeige als „aktiv" sobald mindestens ein Typ aktiv ist.
          const groupCount = visible.reduce((sum, t) => sum + (counts.get(t) ?? 0), 0);
          const state = groupActivation(visible, activeTypes);
          // Repräsentative Farbe = erste Typ-Farbe der Gruppe (alle Typen einer Gruppe
          // teilen ohnehin dieselbe Kategorie-Farbe im SVG).
          const fill = fillFor(visible[0]);
          const stroke = strokeFor(visible[0]);
          const targetActive = state !== 'all';
          return (
            <button
              key={cat.label}
              type="button"
              className={`layout-type-pill layout-type-pill-group${state !== 'none' ? ' active' : ''}${state === 'partial' ? ' partial' : ''}`}
              style={state !== 'none'
                ? { background: fill, borderColor: stroke, color: stroke }
                : undefined}
              onClick={() => onSetTypes(visible, targetActive)}
              title={`${cat.label}: ${visible.join(', ')} (${groupCount})`}
            >
              {cat.label}<span className="layout-type-pill-count">({groupCount})</span>
            </button>
          );
        }

        // Stufe 2: detaillierte Einzel-Typen mit Gruppen-Header.
        return (
          <div key={cat.label} className="layout-type-filter-group">
            <span className="layout-type-filter-cat">{cat.label}</span>
            {visible.map(type => {
              const count = counts.get(type) ?? 0;
              const active = activeTypes.has(type);
              const fill = fillFor(type);
              const stroke = strokeFor(type);
              return (
                <button
                  key={type}
                  type="button"
                  className={`layout-type-pill${active ? ' active' : ''}`}
                  style={active
                    ? { background: fill, borderColor: stroke, color: stroke }
                    : undefined}
                  onClick={() => onToggle(type)}
                  title={`${type} (${count})`}
                >
                  {type}<span className="layout-type-pill-count">({count})</span>
                </button>
              );
            })}
          </div>
        );
      })}
      <div className="layout-type-filter-actions">
        <button
          type="button"
          className="layout-type-filter-link"
          onClick={onToggleDetailsMode}
          title={detailsMode ? 'Auf Gruppen-Übersicht reduzieren' : 'Einzelne Typen anzeigen'}
        >
          {detailsMode ? 'Gruppen' : 'Details'}
        </button>
        {hasAnyActive && (
          <button
            type="button"
            className="layout-type-filter-link"
            onClick={onClear}
            title="Alle Typ-Filter aufheben"
          >
            Filter zurücksetzen
          </button>
        )}
      </div>
    </div>
  );
}
