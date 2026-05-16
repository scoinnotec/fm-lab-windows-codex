import React from 'react';
import type { SortOption, GroupOption } from '../types';
import { optionLabel, tx, type UiLanguage } from '../lib/uiLanguage';

interface SearchOptionsProps {
  sortBy: SortOption;
  groupBy: GroupOption;
  language?: UiLanguage;
  onSortChange: (sort: SortOption) => void;
  onGroupChange: (group: GroupOption) => void;
}

const SORT_OPTIONS: { value: SortOption; label: string; labelEn: string }[] = [
  { value: 'standard', label: 'Standard', labelEn: 'Default' },
  { value: 'name', label: 'Name', labelEn: 'Name' },
  { value: 'type', label: 'Typ', labelEn: 'Type' },
  { value: 'file', label: 'Datei', labelEn: 'File' },
];

const GROUP_OPTIONS: { value: GroupOption; label: string; labelEn: string }[] = [
  { value: 'none', label: 'Keine', labelEn: 'None' },
  { value: 'type', label: 'Typ', labelEn: 'Type' },
  { value: 'file', label: 'Datei', labelEn: 'File' },
];

export const SearchOptions: React.FC<SearchOptionsProps> = ({
  sortBy,
  groupBy,
  language = 'de',
  onSortChange,
  onGroupChange,
}) => (
  <div className="search-options-panel" role="region" aria-label={tx(language, 'Sortier- und Gruppierungsoptionen', 'Sorting and grouping options')}>
    <fieldset className="search-options-fieldset">
      <legend>{tx(language, 'Sortierung:', 'Sorting:')}</legend>
      {SORT_OPTIONS.map(({ value }) => (
        <label key={value} className="search-options-radio">
          <input
            type="radio"
            name="sort"
            value={value}
            checked={sortBy === value}
            onChange={() => onSortChange(value)}
          />
          {optionLabel(SORT_OPTIONS.find(option => option.value === value)!, language)}
        </label>
      ))}
    </fieldset>
    <fieldset className="search-options-fieldset">
      <legend>{tx(language, 'Gruppierung:', 'Grouping:')}</legend>
      {GROUP_OPTIONS.map(({ value }) => (
        <label key={value} className="search-options-radio">
          <input
            type="radio"
            name="group"
            value={value}
            checked={groupBy === value}
            onChange={() => onGroupChange(value)}
          />
          {optionLabel(GROUP_OPTIONS.find(option => option.value === value)!, language)}
        </label>
      ))}
    </fieldset>
  </div>
);
