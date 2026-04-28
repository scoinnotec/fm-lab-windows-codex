import React from 'react';
import type { components } from '@packages/shared/types';
import { Slot } from '../plugins';

type FMObject = components['schemas']['FMObject'];

interface ObjectListItemProps {
  object: FMObject;
  style?: React.CSSProperties;
  onClick?: (uuid: string) => void;
}

/**
 * Object List Item Component
 * Renders a single FileMaker object in the virtual list.
 * Plugins contribute quick-actions via the `objectListItemActions` slot.
 */
export const ObjectListItem: React.FC<ObjectListItemProps> = ({ object, style, onClick }) => {
  const handleClick = () => {
    onClick?.(object.Object_UUID);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

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
          <span className="object-type">
            {object.Object_Type}
          </span>
          <Slot
            name="objectListItemActions"
            objectUuid={object.Object_UUID}
            objectType={object.Object_Type}
            objectName={object.Object_Name || ''}
            fileName={object.File_Name || ''}
          />
        </div>
        <div className="object-details">
          <small>{object.File_Name}</small>
        </div>
      </div>
    </div>
  );
};
