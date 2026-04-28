import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { BreadcrumbItem } from '../types';

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

/**
 * Breadcrumb Navigation Component
 * Shows navigation path: Suche > ObjectType > ObjectName
 */
export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items }) => {
  const navigate = useNavigate();

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol style={{
        display: 'flex',
        gap: '0.5rem',
        listStyle: 'none',
        padding: 0,
        margin: 0,
        fontSize: '0.9rem',
        color: '#888',
        flexWrap: 'wrap',
      }}>
        {items.map((item, index) => (
          <li key={index} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {item.path !== null ? (
              <>
                <button
                  onClick={() => navigate(item.path!)}
                  className="breadcrumb-link"
                  aria-label={`Navigiere zu ${item.label}`}
                >
                  {item.label}
                </button>
                <span aria-hidden="true" style={{ color: '#555' }}>/</span>
              </>
            ) : (
              <span aria-current="page" style={{ color: '#fff' }}>{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
};
