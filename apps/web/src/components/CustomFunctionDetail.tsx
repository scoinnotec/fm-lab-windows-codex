import React from 'react';
import { useCustomFunctionTokens } from '../hooks/useCustomFunctionTokens';
import { CustomFunctionViewer } from './CustomFunctionViewer';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';
import { getUiLanguage, tx } from '../lib/uiLanguage';

interface CustomFunctionDetailProps {
  uuid: string;
  /** Cross-Reference Highlight (PRD §7.2): UUIDs auf Tokens highlighten. */
  highlightRefUuids?: Set<string> | null;
}

/**
 * Wrapper für die token-basierte CustomFunction-Anzeige. Lädt
 * /api/get-details?format=tokens&enrich=de (PRD §5.2) und rendert die
 * Token-Sequenz inkl. Reference-DB-Tooltips für Engine-Funktionen.
 *
 * Sprache aktuell auf 'de' fixiert — kann später aus einer Settings-Quelle
 * (UI-Locale, /reference/categories?lang=...) bezogen werden.
 */
export const CustomFunctionDetail: React.FC<CustomFunctionDetailProps> = ({ uuid, highlightRefUuids }) => {
  const language = getUiLanguage();
  const { data, loading, error, retry } = useCustomFunctionTokens(uuid, language);

  if (loading) return <LoadingSpinner message={tx(language, 'Funktion wird geladen...', 'Loading function...')} />;
  if (error) return <ErrorMessage message={error} onRetry={retry} />;
  if (!data || !data.tokens || data.tokens.length === 0) {
    return <div className="no-references">{tx(language, 'Diese Funktion enthält keinen Formel-Text.', 'This function contains no formula text.')}</div>;
  }

  return <CustomFunctionViewer data={data} highlightRefUuids={highlightRefUuids} />;
};
