import React from 'react';
import { useScriptTokens } from '../hooks/useScriptTokens';
import { ScriptViewer } from './ScriptViewer';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';

interface ScriptDetailProps {
  uuid: string;
  /** Cross-Reference Highlight (PRD §7.2): UUIDs auf Tokens highlighten. */
  highlightRefUuids?: Set<string> | null;
}

export const ScriptDetail: React.FC<ScriptDetailProps> = ({ uuid, highlightRefUuids }) => {
  const { data, loading, error, retry } = useScriptTokens(uuid);

  if (loading) return <LoadingSpinner message="Script wird geladen..." />;
  if (error) return <ErrorMessage message={error} onRetry={retry} />;
  if (!data || !data.lines || data.lines.length === 0) {
    return <div className="no-references">Dieses Script enthält keine Schritte.</div>;
  }

  return <ScriptViewer tokens={data} highlightRefUuids={highlightRefUuids} />;
};
