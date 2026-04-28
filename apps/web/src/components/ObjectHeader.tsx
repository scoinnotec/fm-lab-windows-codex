import React, { useState } from 'react';
import type { FMObject } from '../types';
import { Slot } from '../plugins';

interface ObjectHeaderProps {
  object: FMObject;
}

/**
 * Object Header Component
 * Displays object name, type badge, file name, and UUID with copy button.
 * Plugins contribute action buttons via the `objectHeaderActions` slot.
 */
export const ObjectHeader: React.FC<ObjectHeaderProps> = ({ object }) => {
  const [copied, setCopied] = useState(false);

  const handleCopyUUID = async () => {
    try {
      await navigator.clipboard.writeText(object.Object_UUID);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: silently fail on older browsers
    }
  };

  return (
    <div className="detail-object-header">
      <div className="detail-file-name">
        {object.File_Name}
      </div>
      <div className="detail-title-row">
        <h1 id="object-title" className="detail-title">
          {object.Object_Name || '(ohne Namen)'}
        </h1>
        <Slot
          name="objectHeaderActions"
          objectUuid={object.Object_UUID}
          objectType={object.Object_Type}
          objectName={object.Object_Name || ''}
          fileName={object.File_Name || ''}
        />
      </div>
      <div className="detail-meta">
        <span className="object-type">{object.Object_Type}</span>
        {object.Source_Table && (
          <span className="detail-source">
            Quelle: {object.Source_Table}
          </span>
        )}
      </div>
      <div className="detail-uuid-row">
        <code className="object-uuid">
          {object.Object_UUID}
        </code>
        <button
          onClick={handleCopyUUID}
          className={`copy-button${copied ? ' copied' : ''}`}
          aria-label="UUID in Zwischenablage kopieren"
          title="UUID kopieren"
        >
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
};
