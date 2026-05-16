const environment = require('../../config/environment');
const { createError } = require('../../middleware/error-handler');
const openai = require('./providers/openai.provider');
const anthropic = require('./providers/anthropic.provider');
const ollama = require('./providers/ollama.provider');

const providers = {
  openai,
  anthropic,
  ollama,
};

function normalizeProvider(provider) {
  return String(provider || environment.ai.defaultProvider || 'openai').trim().toLowerCase();
}

function getProvider(provider) {
  const id = normalizeProvider(provider);
  const selected = providers[id];
  if (!selected) {
    throw createError(
      'AI_CONFIG_ERROR',
      `AI provider "${provider}" is not available.`,
      { available: Object.keys(providers) }
    );
  }
  return { id, provider: selected };
}

function listProviders() {
  return Object.values(providers).map((provider) => provider.getInfo());
}

async function generate({ provider, model, systemPrompt, messages, credentials }) {
  const selected = getProvider(provider);
  return selected.provider.generate({
    systemPrompt,
    messages,
    model,
    credentials,
  });
}

module.exports = {
  generate,
  getProvider,
  listProviders,
  normalizeProvider,
};
