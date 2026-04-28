import React from 'react';
import type { SortOption, GroupOption } from '../types';

interface SearchOptionsProps {
  sortBy: SortOption;
  groupBy: GroupOption;
  onSortChange: (sort: SortOption) => void;
  onGroupChange: (group: GroupOption) => void;
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'name', label: 'Name' },
  { value: 'type', label: 'Typ' },
  { value: 'file', label: 'Datei' },
];

const GROUP_OPTIONS: { value: GroupOption; label: string }[] = [
  { value: 'none', label: 'Keine' },
  { value: 'type', label: 'Typ' },
  { value: 'file', label: 'Datei' },
];

export const SearchOptions: React.FC<SearchOptionsProps> = ({
  sortBy,
  groupBy,
  onSortChange,
  onGroupChange,
}) => (
  <div className="search-options-panel" role="region" aria-label="Sortier- und Gruppierungsoptionen">
    <fieldset className="search-options-fieldset">
      <legend>Sortierung:</legend>
      {SORT_OPTIONS.map(({ value, label }) => (
        <label key={value} className="search-options-radio">
          <input
            type="radio"
            name="sort"
            value={value}
            checked={sortBy === value}
            onChange={() => onSortChange(value)}
          />
          {label}
        </label>
      ))}
    </fieldset>
    <fieldset className="search-options-fieldset">
      <legend>Gruppierung:</legend>
      {GROUP_OPTIONS.map(({ value, label }) => (
        <label key={value} className="search-options-radio">
          <input
            type="radio"
            name="group"
            value={value}
            checked={groupBy === value}
            onChange={() => onGroupChange(value)}
          />
          {label}
        </label>
      ))}
    </fieldset>
  </div>
);
