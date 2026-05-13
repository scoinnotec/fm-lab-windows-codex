import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { PluginCard, type PluginInfo } from '../components/PluginCard';
import { ThemeToggle } from '../components/ThemeToggle';
import './SettingsView.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3003';

export const SettingsView: React.FC = () => {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restartPending, setRestartPending] = useState<Set<string>>(new Set());
  const [expandedName, setExpandedName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/plugins`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Fehler beim Laden');
      setPlugins(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
    if (!json.success) throw new Error(json.error?.message || 'Fehler beim Speichern');

    if (json.data.requires_restart) {
      setRestartPending((prev) => new Set(prev).add(name));
    }

    // Refetch to pick up merged state
    await load();
  }, [load]);

  return (
    <div className="settings-view">
      <div className="settings-header">
        <Link to="/" className="settings-back" aria-label="Zurück zur Suche">← Zurück</Link>
        <h1>Plugin-Verwaltung</h1>
        <div style={{ marginLeft: 'auto' }}>
          <ThemeToggle />
        </div>
      </div>

      {loading && <div className="settings-loading">Lade Plugins...</div>}
      {error && <div className="settings-error">{error}</div>}

      {!loading && !error && plugins.length === 0 && (
        <div className="settings-empty">Keine Plugins installiert.</div>
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
