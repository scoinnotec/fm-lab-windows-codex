import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { PluginCard, type PluginInfo } from '../components/PluginCard';
import { ThemeToggle } from '../components/ThemeToggle';
import { getAiClientSettings, saveAiClientSettings, type AiClientSettings } from '../lib/aiSettings';
import { getUiLanguage, tx } from '../lib/uiLanguage';
import './SettingsView.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3003';

export const SettingsView: React.FC = () => {
  const language = getUiLanguage();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restartPending, setRestartPending] = useState<Set<string>>(new Set());
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<AiClientSettings>(() => getAiClientSettings());
  const [aiSettingsSaved, setAiSettingsSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/plugins`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || tx(language, 'Fehler beim Laden', 'Loading failed'));
      setPlugins(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [language]);

  useEffect(() => {
    load();
  }, [language, load]);

  const handleUpdate = useCallback(async (
    name: string,
    patch: { enabled?: boolean; settings?: Record<string, unknown> },
  ) => {
    const res = await fetch(`${API_BASE}/api/plugins/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message || tx(language, 'Fehler beim Speichern', 'Saving failed'));

    if (json.data.requires_restart) {
      setRestartPending((prev) => new Set(prev).add(name));
    }

    // Refetch to pick up merged state
    await load();
  }, [load]);

  const handleSaveAiSettings = useCallback(() => {
    saveAiClientSettings(aiSettings);
    setAiSettingsSaved(true);
    window.setTimeout(() => setAiSettingsSaved(false), 2200);
  }, [aiSettings]);

  const handleClearAiSettings = useCallback(() => {
    const empty = { openaiCredential: '', anthropicCredential: '' };
    setAiSettings(empty);
    saveAiClientSettings(empty);
    setAiSettingsSaved(true);
    window.setTimeout(() => setAiSettingsSaved(false), 2200);
  }, []);

  return (
    <div className="settings-view">
      <div className="settings-header">
        <Link to="/" className="settings-back" aria-label={tx(language, 'Zurück zur Suche', 'Back to search')}>← {tx(language, 'Zurück', 'Back')}</Link>
        <h1>{tx(language, 'Plugin-Verwaltung', 'Plugin management')}</h1>
        <div style={{ marginLeft: 'auto' }}>
          <ThemeToggle />
        </div>
      </div>

      {loading && <div className="settings-loading">{tx(language, 'Lade Plugins...', 'Loading plugins...')}</div>}
      {error && <div className="settings-error">{error}</div>}

      <section className="settings-section">
        <div className="settings-section-header">
          <h2>{tx(language, 'AI-Chat', 'AI chat')}</h2>
          <p>
            {tx(
              language,
              'API-Schlüssel werden nur in diesem Browser gespeichert und pro Chat-Anfrage an die lokale REST-API gesendet. Sie werden nicht in .env, DuckDB, Chat-JSON oder Markdown-Exports gespeichert.',
              'API keys are stored only in this browser and sent to the local REST API per chat request. They are not stored in .env, DuckDB, chat JSON, or Markdown exports.'
            )}
          </p>
        </div>

        <div className="settings-ai-grid">
          <label className="plugin-card-field">
            <span>OpenAI / Codex API key</span>
            <input
              type="password"
              autoComplete="off"
              value={aiSettings.openaiCredential}
              onChange={(event) => setAiSettings((prev) => ({ ...prev, openaiCredential: event.target.value }))}
              placeholder="sk-..."
            />
          </label>

          <label className="plugin-card-field">
            <span>Claude / Anthropic API key</span>
            <input
              type="password"
              autoComplete="off"
              value={aiSettings.anthropicCredential}
              onChange={(event) => setAiSettings((prev) => ({ ...prev, anthropicCredential: event.target.value }))}
              placeholder="sk-ant-..."
            />
          </label>
        </div>

        <div className="settings-ai-actions">
          <button type="button" className="plugin-card-save" onClick={handleSaveAiSettings}>
            {tx(language, 'Lokal speichern', 'Save locally')}
          </button>
          <button type="button" className="settings-secondary-button" onClick={handleClearAiSettings}>
            {tx(language, 'Lokale Schlüssel löschen', 'Clear local keys')}
          </button>
          {aiSettingsSaved && <span className="settings-save-note">{tx(language, 'Gespeichert.', 'Saved.')}</span>}
        </div>
      </section>

      {!loading && !error && plugins.length === 0 && (
        <div className="settings-empty">{tx(language, 'Keine Plugins installiert.', 'No plugins installed.')}</div>
      )}

      <div className="plugin-list">
        {plugins.map((plugin) => (
          <PluginCard
            key={plugin.name}
            plugin={plugin}
            restartPending={restartPending.has(plugin.name)}
            expanded={expandedName === plugin.name}
            onToggleExpand={() => setExpandedName((prev) => (prev === plugin.name ? null : plugin.name))}
            onUpdate={(patch) => handleUpdate(plugin.name, patch)}
          />
        ))}
      </div>
    </div>
  );
};
