import React from 'react';
import { useFieldTokens } from '../hooks/useFieldTokens';
import { FieldViewer } from './FieldViewer';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';

interface FieldDetailProps {
  uuid: string;
  /** Cross-Reference Highlight (PRD §7.2): UUIDs auf Tokens highlighten. */
  highlightRefUuids?: Set<string> | null;
}

/**
 * Wrapper für die token-basierte Field-Anzeige. Lädt
 * /api/get-details?format=tokens&enrich=de (PRD §5.2) für Felder mit
 * Calculation- oder AutoEnter-Calculation-Formel und rendert Metadaten
 * + Token-Sequenz inkl. Reference-DB-Tooltips.
 */
export const FieldDetail: React.FC<FieldDetailProps> = ({ uuid, highlightRefUuids }) => {
  const { data, loading, error, retry } = useFieldTokens(uuid, 'de');

  if (loading) return <LoadingSpinner message="Feld wird geladen..." />;
  if (error) return <ErrorMessage message={error} onRetry={retry} />;
  if (!data) return <div className="no-references">Keine Field-Details verfügbar.</div>;

  return <FieldViewer data={data} highlightRefUuids={highlightRefUuids} />;
};
