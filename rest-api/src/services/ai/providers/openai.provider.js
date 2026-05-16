const environment = require('../../../config/environment');
const { createError } = require('../../../middleware/error-handler');
const { fetchProviderJson } = require('../provider-error-utils');

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function extractText(payload) {
  if (payload?.output_text) {
    return String(payload.output_text);
  }

  const chunks = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && content?.text) {
        chunks.push(content.text);
      } else if (content?.text) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join('\n').trim();
}

async function generate({ systemPrompt, messages, model, credentials }) {
  const config = environment.ai.openai;
  const modelName = model || config.model;
  const apiKey = String(credentials?.apiKey || '').trim();
  if (!apiKey) {
    throw createError(
      'AI_CONFIG_ERROR',
      'OpenAI API key fehlt. Bitte im Web-Client unter Einstellungen lokal hinterlegen.'
    );
  }

  const { response, payload } = await fetchProviderJson({
    provider: 'openai',
    baseUrl: config.baseUrl,
    model: modelName,
    url: `${stripTrailingSlash(config.baseUrl)}/responses`,
    options: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        input: [
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
      payload?.error?.message || `OpenAI request failed with status ${response.status}`,
      { provider: 'openai', status: response.status }
    );
  }

  const content = extractText(payload);
  if (!content) {
    throw createError(
      'AI_PROVIDER_ERROR',
      'OpenAI response did not contain assistant text.',
      { provider: 'openai' }
    );
  }

  return {
    provider: 'openai',
    model: modelName,
    content,
  };
}

function getInfo() {
  const config = environment.ai.openai;
  return {
    id: 'openai',
    label: 'OpenAI / Codex',
    configured: false,
    default_model: config.model,
    base_url: config.baseUrl,
  };
}

module.exports = {
  generate,
  getInfo,
};
