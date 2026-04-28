import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { GroupedReferences, ReferenceItem } from '../types';

interface HierarchyTreeProps {
  references: GroupedReferences;
}

/**
 * Hierarchy Tree Component
 * Displays parent (upstream) and child (downstream) references as clickable lists
 */
export const HierarchyTree: React.FC<HierarchyTreeProps> = ({ references }) => {
  const navigate = useNavigate();

  const handleReferenceClick = (uuid: string) => {
    navigate(`/object/${uuid}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent, uuid: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleReferenceClick(uuid);
    }
  };

  const renderReferenceItem = (ref: ReferenceItem) => (
    <li
      key={`${ref.uuid}-${ref.Link_Role}`}
      className="reference-item"
      onClick={() => handleReferenceClick(ref.uuid)}
      onKeyDown={(e) => handleKeyDown(e, ref.uuid)}
      tabIndex={0}
      role="button"
      aria-label={`Navigiere zu ${ref.Object_Type}: ${ref.Object_Name}`}
    >
      <span className="object-type">
        {ref.Object_Type}
      </span>
      <span className="ref-name">
        {ref.Object_Name}
      </span>
      <span className="ref-file">
        ({ref.File_Name})
      </span>
      {ref.Is_Cross_File && (
        <span className="cross-file-badge">
          Cross-File
        </span>
      )}
      <span className="ref-role">
        {ref.Link_Role}
      </span>
    </li>
  );

  const hasParents = references.parent.length > 0;
  const hasChildren = references.child.length > 0;

  return (
    <nav className="hierarchy-tree" aria-label="Objekt-Hierarchie">
      {/* Parent References (upstream - what references this object) */}
      {hasParents && (
        <section className="hierarchy-section">
          <h2>Wird verwendet von ({references.parent.length})</h2>
          <ul className="reference-list">
            {references.parent.map(renderReferenceItem)}
          </ul>
        </section>
      )}

      {/* Child References (downstream - what this object references) */}
      {hasChildren && (
        <section className="hierarchy-section">
          <h2>Verwendet ({references.child.length})</h2>
          <ul className="reference-list">
            {references.child.map(renderReferenceItem)}
          </ul>
        </section>
      )}

      {/* No references */}
      {!hasParents && !hasChildren && (
        <div className="no-references">
          Keine Referenzen gefunden
        </div>
      )}
    </nav>
  );
};
