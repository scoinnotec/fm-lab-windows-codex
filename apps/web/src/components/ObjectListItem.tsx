import React from 'react';
import type { components } from '@packages/shared/types';
import { Slot } from '../plugins';

type FMObject = components['schemas']['FMObject'];

// PRD prd_pseudo_object_types_filter.md §8.3 — optionale Pseudo-Token-Felder,
// vom /api/list-Endpoint mit ?with_usage=true / ?with_category=true geliefert.
// Da der generierte FMObject-Typ diese Spalten nicht kennt, indizieren wir
// lose über das ursprüngliche Object.
type FMObjectWithAggregates = FMObject & {
  usage_count?: number;
  category?: string | null;
  category_id?: number | null;
  is_get_subparam?: boolean;
};

interface ObjectListItemProps {
  object: FMObject;
  style?: React.CSSProperties;
  onClick?: (uuid: string) => void;
  // Wenn gesetzt, klick auf die Category-Pille toggelt diesen Wert in der
  // übergeordneten Filter-Toolbar (PRD §8.3).
  onCategoryClick?: (category: string) => void;
}

/**
 * Object List Item Component
 * Renders a single FileMaker object in the virtual list.
 * Plugins contribute quick-actions via the `objectListItemActions` slot.
 */
export const ObjectListItem: React.FC<ObjectListItemProps> = ({ object, style, onClick, onCategoryClick }) => {
  const aggObject = object as FMObjectWithAggregates;
  const handleClick = () => {
    onClick?.(object.Object_UUID);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const hasUsage = typeof aggObject.usage_count === 'number';
  const hasCategory = aggObject.category != null && aggObject.category !== '';

  return (
    <div style={style} className="object-list-item-wrapper">
      <div
        className="object-list-item"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-label={`${object.Object_Type}: ${object.Object_Name || '(ohne Namen)'} anzeigen`}
      >
        <div className="object-header">
          <strong className="object-name">
            {object.Object_Name || '(ohne Namen)'}
          </strong>
          {hasCategory && (
            <span
              className="object-category-pill"
              role={onCategoryClick ? 'button' : undefined}
              tabIndex={onCategoryClick ? 0 : -1}
              onClick={(e) => {
                if (!onCategoryClick) return;
                e.stopPropagation();
                onCategoryClick(aggObject.category as string);
              }}
              onKeyDown={(e) => {
                if (!onCategoryClick) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onCategoryClick(aggObject.category as string);
                }
              }}
              title={onCategoryClick ? `Filter auf ${aggObject.category}` : aggObject.category as string}
            >
              {aggObject.category}
            </span>
          )}
          <span className="object-type">
            {object.Object_Type}
          </span>
          {hasUsage && (
            <span className="object-usage-badge" title={`${aggObject.usage_count} Verwendung${aggObject.usage_count === 1 ? '' : 'en'}`}>
              {aggObject.usage_count}
            </span>
          )}
          <Slot
            name="objectListItemActions"
            objectUuid={object.Object_UUID}
            objectType={object.Object_Type}
            objectName={object.Object_Name || ''}
            fileName={object.File_Name || ''}
          />
        </div>
        {object.File_Name && (
          <div className="object-details">
            <small>{object.File_Name}</small>
          </div>
        )}
      </div>
    </div>
  );
};
