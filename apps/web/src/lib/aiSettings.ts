export type AiClientSettings = {
  openaiCredential: string;
  anthropicCredential: string;
};

const STORAGE_KEYS = {
  openaiCredential: 'fm-lab.ai.openai.localCredential',
  anthropicCredential: 'fm-lab.ai.anthropic.localCredential',
};

function getLocalValue(key: string) {
  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function setLocalValue(key: string, value: string) {
  try {
    const trimmed = value.trim();
    if (trimmed) {
      window.localStorage.setItem(key, trimmed);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Browser storage can be disabled; callers still keep in-memory state.
  }
}

export function getAiClientSettings(): AiClientSettings {
  return {
    openaiCredential: getLocalValue(STORAGE_KEYS.openaiCredential),
    anthropicCredential: getLocalValue(STORAGE_KEYS.anthropicCredential),
  };
}

export function saveAiClientSettings(settings: AiClientSettings) {
  setLocalValue(STORAGE_KEYS.openaiCredential, settings.openaiCredential);
  setLocalValue(STORAGE_KEYS.anthropicCredential, settings.anthropicCredential);
}

export function getCredentialForProvider(provider: string, settings = getAiClientSettings()) {
  if (provider === 'openai') return settings.openaiCredential;
  if (provider === 'anthropic') return settings.anthropicCredential;
  return '';
}

export function hasLocalCredentials(provider: string, settings = getAiClientSettings()) {
  if (provider === 'ollama') return true;
  return getCredentialForProvider(provider, settings).trim().length > 0;
}
