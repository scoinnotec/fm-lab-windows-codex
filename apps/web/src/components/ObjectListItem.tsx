import React from 'react';
import type { components } from '@packages/shared/types';
import { Slot } from '../plugins';
import { getUiLanguage, objectTypeLabel, tx } from '../lib/uiLanguage';

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
  onSendToAiChat?: (prompt: string) => void;
  // Wenn gesetzt, klick auf die Category-Pille toggelt diesen Wert in der
  // übergeordneten Filter-Toolbar (PRD §8.3).
  onCategoryClick?: (category: string) => void;
}

function buildObjectPositionPrompt(object: FMObject, language: 'de' | 'en') {
  const name = object.Object_Name || tx(language, '(ohne Namen)', '(without name)');
  const typeLabel = objectTypeLabel(object.Object_Type, language);
  return [
    tx(
      language,
      'Bitte analysiere dieses konkrete FileMaker-Objekt aus der aktuellen Trefferliste und gib konkrete Prüf-, Optimierungs- und Refactoring-Vorschläge.',
      'Please analyze this concrete FileMaker object from the current result list and provide concrete review, optimization, and refactoring suggestions.',
    ),
    '',
    'Object context:',
    `- Name: ${name}`,
    `- Type: ${typeLabel} (${object.Object_Type})`,
    `- File: ${object.File_Name || '-'}`,
    `- Source table: ${object.Source_Table || '-'}`,
    `- UUID: ${object.Object_UUID}`,
  ].join('\n');
}

/**
 * Object List Item Component
 * Renders a single FileMaker object in the virtual list.
 * Plugins contribute quick-actions via the `objectListItemActions` slot.
 */
export const ObjectListItem: React.FC<ObjectListItemProps> = ({ object, style, onClick, onSendToAiChat, onCategoryClick }) => {
  const aggObject = object as FMObjectWithAggregates;
  const language = getUiLanguage();
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
        aria-label={`${objectTypeLabel(object.Object_Type, language)}: ${object.Object_Name || tx(language, '(ohne Namen)', '(without name)')} ${tx(language, 'anzeigen', 'show')}`}
      >
        <div className="object-header">
          <strong className="object-name">
            {object.Object_Name || tx(language, '(ohne Namen)', '(without name)')}
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
              title={onCategoryClick ? tx(language, `Filter auf ${aggObject.category}`, `Filter by ${aggObject.category}`) : aggObject.category as string}
            >
              {aggObject.category}
            </span>
          )}
          <span className="object-type">
            {objectTypeLabel(object.Object_Type, language)}
          </span>
          {hasUsage && (
            <span className="object-usage-badge" title={`${aggObject.usage_count} ${tx(language, aggObject.usage_count === 1 ? 'Verwendung' : 'Verwendungen', aggObject.usage_count === 1 ? 'use' : 'uses')}`}>
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
          {onSendToAiChat && (
            <button
              type="button"
              className="object-ai-action"
              onClick={(e) => {
                e.stopPropagation();
                onSendToAiChat(buildObjectPositionPrompt(object, language));
              }}
              title={tx(language, 'Dieses Objekt an den AI-Chat übergeben', 'Send this object to AI chat')}
              aria-label={tx(language, `${object.Object_Name || 'Objekt'} an den AI-Chat übergeben`, `Send ${object.Object_Name || 'object'} to AI chat`)}
            >
              AI
            </button>
          )}
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
