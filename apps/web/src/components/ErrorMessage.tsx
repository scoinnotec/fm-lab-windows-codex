import React from 'react';
import { getUiLanguage, tx } from '../lib/uiLanguage';

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

/**
 * Error Message Component
 * Displays an error with optional retry button
 */
export const ErrorMessage: React.FC<ErrorMessageProps> = ({ message, onRetry }) => {
  const language = getUiLanguage();
  return (
    <div
      className="error-detail"
      role="alert"
      style={{
        padding: '2rem',
        textAlign: 'center',
        background: '#4a1a1a',
        border: '1px solid #8a2a2a',
        borderRadius: '8px',
        color: '#ff6b6b',
      }}
    >
      <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>!</div>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>{tx(language, 'Fehler beim Laden', 'Loading failed')}</h3>
      <p style={{ margin: '0 0 1rem', color: '#ccc' }}>{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{ padding: '0.5rem 1.5rem' }}
          aria-label={tx(language, 'Erneut versuchen', 'Retry')}
        >
          {tx(language, 'Erneut versuchen', 'Retry')}
        </button>
      )}
    </div>
  );
};
