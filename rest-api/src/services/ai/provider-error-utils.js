const { createError } = require('../../middleware/error-handler');

function normalizeCause(error) {
  const message = String(error?.message || error || '').trim();
  const cause = String(error?.cause?.message || error?.cause?.code || '').trim();
  return cause && cause !== message ? `${message}: ${cause}` : message;
}

function providerLabel(provider) {
  if (provider === 'ollama') return 'Ollama';
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'anthropic') return 'Anthropic';
  return provider || 'AI provider';
}

function createProviderConnectionError({ provider, baseUrl, model, error }) {
  const label = providerLabel(provider);
  const technicalMessage = normalizeCause(error) || 'connection failed';
  return createError(
    'AI_PROVIDER_ERROR',
    `${label} konnte nicht erreicht werden. Bitte pruefe, ob der Dienst laeuft, ob die Base URL stimmt und ob das Modell verfuegbar ist.`,
    {
      provider,
      provider_label: label,
      base_url: baseUrl,
      model,
      technical_message: technicalMessage,
      hint:
        provider === 'ollama'
          ? `Ollama lokal starten oder pruefen: ollama serve; Modell pruefen: ollama list; Modell laden: ollama pull ${model || '<model>'}.`
          : 'Provider-Base-URL, Netzwerkverbindung und API-Zugang pruefen.',
    }
  );
}

function providerTimeoutMs() {
  const configured = Number(process.env.AI_PROVIDER_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 120000;
}

async function fetchProviderJson({ provider, baseUrl, model, url, options }) {
  let response;
  const timeoutMs = providerTimeoutMs();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    response = await fetch(url, {
      ...(options || {}),
      signal: controller.signal,
    });
  } catch (error) {
    const decorated = timedOut
      ? new Error(`request timed out after ${Math.round(timeoutMs / 1000)} seconds`)
      : error;
    throw createProviderConnectionError({ provider, baseUrl, model, error: decorated });
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

module.exports = {
  fetchProviderJson,
};
