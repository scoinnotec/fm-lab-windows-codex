const environment = require('../../../config/environment');
const { createError } = require('../../../middleware/error-handler');
const { fetchProviderJson } = require('../provider-error-utils');

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

async function generate({ systemPrompt, messages, model, credentials }) {
  const config = environment.ai.anthropic;
  const modelName = model || config.model;
  const apiKey = String(credentials?.apiKey || '').trim();
  if (!apiKey) {
    throw createError(
      'AI_CONFIG_ERROR',
      'Anthropic API key fehlt. Bitte im Web-Client unter Einstellungen lokal hinterlegen.'
    );
  }

  const { response, payload } = await fetchProviderJson({
    provider: 'anthropic',
    baseUrl: config.baseUrl,
    model: modelName,
    url: `${stripTrailingSlash(config.baseUrl)}/messages`,
    options: {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 3000,
        system: systemPrompt,
        messages: messages.map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content,
        })),
      }),
    },
  });
  if (!response.ok) {
    throw createError(
      'AI_PROVIDER_ERROR',
      payload?.error?.message || `Anthropic request failed with status ${response.status}`,
      { provider: 'anthropic', status: response.status }
    );
  }

  const content = (payload?.content || [])
    .map((part) => part?.text || '')
    .filter(Boolean)
    .join('\n')
    .trim();

  if (!content) {
    throw createError(
      'AI_PROVIDER_ERROR',
      'Anthropic response did not contain assistant text.',
      { provider: 'anthropic' }
    );
  }

  return {
    provider: 'anthropic',
    model: modelName,
    content,
  };
}

function getInfo() {
  const config = environment.ai.anthropic;
  return {
    id: 'anthropic',
    label: 'Claude / Anthropic',
    configured: false,
    default_model: config.model,
    base_url: config.baseUrl,
  };
}

module.exports = {
  generate,
  getInfo,
};
