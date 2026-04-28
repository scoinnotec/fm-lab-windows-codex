const { buildSuccess } = require('../utils/response-builder');
const { getLoadedPlugins } = require('../plugins/loader');
const settingsStore = require('../plugins/settings-store');

/**
 * Plugins Controller
 * Exposes a generic API over all loaded plugins — used by the Settings UI
 * to list, toggle and configure plugins.
 *
 * Toggling is persistent (writes to .fmlab/plugins.json) but requires a
 * server restart to take effect on the routing layer. The response flags
 * this via `requires_restart: true` so the UI can show a hint.
 */

function serializePlugin(manifest) {
  return {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    enabled: manifest.enabled,
    routes_prefix: manifest.routes_prefix,
    settings: manifest.config || {},
    settings_schema: manifest.settings_schema || null,
    ui: manifest.ui || null,
  };
}

/**
 * GET /api/plugins — list all installed plugins
 */
function list(req, res) {
  const plugins = getLoadedPlugins();
  const data = Object.values(plugins).map(serializePlugin);
  res.json(buildSuccess(data));
}

/**
 * GET /api/plugins/:name — details for a single plugin
 */
function get(req, res) {
  const plugins = getLoadedPlugins();
  const manifest = plugins[req.params.name];
  if (!manifest) {
    return res.status(404).json({
      success: false,
      error: { code: 'PLUGIN_NOT_FOUND', message: `Unknown plugin: ${req.params.name}` },
    });
  }
  res.json(buildSuccess(serializePlugin(manifest)));
}

/**
 * PATCH /api/plugins/:name — update enabled and/or settings.
 * Body: { enabled?: boolean, settings?: object }
 */
function patch(req, res) {
  const plugins = getLoadedPlugins();
  const manifest = plugins[req.params.name];
  if (!manifest) {
    return res.status(404).json({
      success: false,
      error: { code: 'PLUGIN_NOT_FOUND', message: `Unknown plugin: ${req.params.name}` },
    });
  }

  const { enabled, settings } = req.body || {};

  if (enabled === undefined && settings === undefined) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'NO_VALID_FIELDS',
        message: 'Body must contain "enabled" and/or "settings"',
      },
    });
  }

  let requiresRestart = false;

  if (typeof enabled === 'boolean' && enabled !== manifest.enabled) {
    settingsStore.setEnabledState(manifest.name, enabled);
    requiresRestart = true;
  }

  if (settings && typeof settings === 'object') {
    const allowedKeys = Object.keys(manifest.config || {});
    const merged = settingsStore.setSettings(manifest.name, settings, allowedKeys);
    // Reflect changes in the in-memory manifest so GET sees them immediately
    manifest.config = { ...(manifest.config || {}), ...merged };
  }

  res.json(buildSuccess({
    ...serializePlugin(manifest),
    requires_restart: requiresRestart,
  }));
}

module.exports = { list, get, patch };
