const environment = require('../../../config/environment');
const { createError } = require('../../../middleware/error-handler');
const { fetchProviderJson } = require('../provider-error-utils');

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

async function generate({ systemPrompt, messages, model }) {
  const config = environment.ai.ollama;
  const modelName = model || config.model;

  const { response, payload } = await fetchProviderJson({
    provider: 'ollama',
    baseUrl: config.baseUrl,
    model: modelName,
    url: `${stripTrailingSlash(config.baseUrl)}/api/chat`,
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.content,
          })),
        ],
      }),
    },
  });
  if (!response.ok) {
    throw createError(
      'AI_PROVIDER_ERROR',
      payload?.error || `Ollama request failed with status ${response.status}`,
      { provider: 'ollama', status: response.status }
    );
  }

  const content = String(payload?.message?.content || '').trim();
  if (!content) {
    throw createError(
      'AI_PROVIDER_ERROR',
      'Ollama response did not contain assistant text.',
      { provider: 'ollama' }
    );
  }

  return {
    provider: 'ollama',
    model: modelName,
    content,
  };
}

function getInfo() {
  const config = environment.ai.ollama;
  return {
    id: 'ollama',
    label: 'Ollama',
    configured: true,
    default_model: config.model,
    base_url: config.baseUrl,
  };
}

module.exports = {
  generate,
  getInfo,
};
