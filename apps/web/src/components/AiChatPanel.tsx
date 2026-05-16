import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  createAiConversation,
  deleteAiConversation,
  exportAiConversationMarkdown,
  getAiConversation,
  getAiProviders,
  listAiConversations,
  sendAiMessage,
  ApiClientError,
  type AiConversation,
  type AiConversationSummary,
  type AiProviderInfo,
} from '../api/client';
import { getAiClientSettings, getCredentialForProvider, hasLocalCredentials, type AiClientSettings } from '../lib/aiSettings';
import { tx, type UiLanguage } from '../lib/uiLanguage';

type Props = {
  language: UiLanguage;
};

const AI_CHAT_DRAFT_STORAGE_KEY = 'fm-lab-ai-chat-draft';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function detailText(details: Record<string, unknown>, key: string) {
  const value = details[key];
  return value === undefined || value === null ? '' : String(value);
}

function formatAiChatError(
  error: unknown,
  language: UiLanguage,
  context: { provider?: string; providerLabel?: string; model?: string } = {}
) {
  const apiError = error instanceof ApiClientError ? error : null;
  const genericMessage = error instanceof Error ? error.message : String(error || '');
  const details = asRecord(apiError?.details);
  const code = apiError?.code || '';
  const providerId = detailText(details, 'provider') || context.provider || '';
  const providerLabel = detailText(details, 'provider_label') || context.providerLabel || providerId || 'AI';
  const modelName = detailText(details, 'model') || context.model || '';
  const baseUrl = detailText(details, 'base_url');
  const technical = detailText(details, 'technical_message') || genericMessage;
  const hint = detailText(details, 'hint');

  if (code === 'NETWORK_ERROR') {
    return [
      tx(language, 'Die lokale REST-API ist nicht erreichbar.', 'The local REST API is not reachable.'),
      tx(language, 'Bitte pruefe, ob das Projekt gestartet ist.', 'Please check whether the project is running.'),
      detailText(details, 'base_url') ? `API: ${detailText(details, 'base_url')}` : '',
      technical ? `Technik: ${technical}` : '',
      hint || '',
    ].filter(Boolean).join('\n');
  }

  if (
    code === 'AI_PROVIDER_ERROR' ||
    /fetch failed|failed to fetch|connection refused|econnrefused/i.test(genericMessage)
  ) {
    if (providerId === 'ollama' || providerLabel.toLowerCase().includes('ollama')) {
      return [
        tx(language, 'Ollama konnte nicht erreicht werden.', 'Ollama could not be reached.'),
        `Provider: ${providerLabel}`,
        modelName ? `${tx(language, 'Modell', 'Model')}: ${modelName}` : '',
        baseUrl ? `URL: ${baseUrl}` : '',
        tx(language, 'Bitte pruefe:', 'Please check:'),
        tx(language, '- Laeuft Ollama lokal oder die Ollama-App?', '- Is Ollama or the Ollama app running locally?'),
        modelName
          ? tx(language, `- Ist das Modell vorhanden? Pruefen mit "ollama list", laden mit "ollama pull ${modelName}".`, `- Is the model available? Check with "ollama list", pull with "ollama pull ${modelName}".`)
          : tx(language, '- Ist das ausgewaehlte Modell in Ollama vorhanden?', '- Is the selected model available in Ollama?'),
        tx(language, '- Falls Ollama nicht lokal laeuft: OLLAMA_BASE_URL in rest-api/.env setzen und API neu starten.', '- If Ollama does not run locally: set OLLAMA_BASE_URL in rest-api/.env and restart the API.'),
        technical ? `Technik: ${technical}` : '',
      ].filter(Boolean).join('\n');
    }

    return [
      tx(language, 'Der AI-Provider konnte nicht erfolgreich antworten.', 'The AI provider could not answer successfully.'),
      `Provider: ${providerLabel}`,
      modelName ? `${tx(language, 'Modell', 'Model')}: ${modelName}` : '',
      baseUrl ? `URL: ${baseUrl}` : '',
      hint || tx(language, 'Bitte pruefe API-Schluessel, Modellname, Base URL und Netzwerkverbindung.', 'Please check API key, model name, base URL, and network connection.'),
      technical ? `Technik: ${technical}` : '',
    ].filter(Boolean).join('\n');
  }

  if (code === 'AI_CONFIG_ERROR') {
    return [
      tx(language, 'AI-Konfiguration unvollstaendig.', 'AI configuration is incomplete.'),
      genericMessage,
    ].filter(Boolean).join('\n');
  }

  return genericMessage || tx(language, 'Unbekannter Fehler im AI-Chat.', 'Unknown AI chat error.');
}

function formatDate(value: string | undefined, language: UiLanguage) {
  if (!value) return '';
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'de-DE', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function safeFileName(value: string) {
  return (value || 'ai-database-chat')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'ai-database-chat';
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-1000px';
  textarea.style.top = '-1000px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function messageToPlainText(message: AiConversation['messages'][number], language: UiLanguage) {
  const label = message.role === 'assistant'
    ? tx(language, 'Assistant', 'Assistant')
    : tx(language, 'You', 'You');
  return `${label}\n${formatDate(message.created_at, language)}\n${message.content}`.trim();
}

function conversationToPlainText(conversation: AiConversation, language: UiLanguage) {
  return [
    conversation.title,
    '',
    ...conversation.messages.map((item) => messageToPlainText(item, language)),
  ].join('\n\n---\n\n').trim();
}

export function AiChatPanel({ language }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [providers, setProviders] = useState<AiProviderInfo[]>([]);
  const [conversations, setConversations] = useState<AiConversationSummary[]>([]);
  const [conversation, setConversation] = useState<AiConversation | null>(null);
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('');
  const [message, setMessage] = useState('');
  const [clientSettings, setClientSettings] = useState<AiClientSettings>(() => getAiClientSettings());
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const draftAppliedRef = useRef(false);

  const selectedProvider = useMemo(
    () => providers.find((entry) => entry.id === provider),
    [providers, provider]
  );
  const selectedProviderConfigured = hasLocalCredentials(provider, clientSettings);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [providerPayload, conversationPayload] = await Promise.all([
          getAiProviders(),
          listAiConversations(),
        ]);
        if (cancelled) return;
        const providerList = providerPayload.data || [];
        const summaries = conversationPayload.data || [];
        const localSettings = getAiClientSettings();
        setClientSettings(localSettings);
        setProviders(providerList);
        setConversations(summaries);
        const firstConfigured = providerList.find((entry) => hasLocalCredentials(entry.id, localSettings)) || providerList[0];
        if (firstConfigured) {
          setProvider(firstConfigured.id);
          setModel(firstConfigured.default_model || '');
        }
        if (summaries[0]) {
          const detail = await getAiConversation(summaries[0].id);
          if (!cancelled) {
            setConversation(detail.data || null);
            setProvider(detail.data?.provider || firstConfigured?.id || 'openai');
            setModel(detail.data?.model || firstConfigured?.default_model || '');
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(formatAiChatError(loadError, language));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation?.messages.length]);

  useEffect(() => {
    if (draftAppliedRef.current) return;
    draftAppliedRef.current = true;

    let storedDraft = '';
    try {
      storedDraft = window.sessionStorage.getItem(AI_CHAT_DRAFT_STORAGE_KEY) || '';
      if (storedDraft) {
        window.sessionStorage.removeItem(AI_CHAT_DRAFT_STORAGE_KEY);
      }
    } catch {
      storedDraft = '';
    }

    const urlDraft = searchParams.get('draft') || '';
    const draft = (storedDraft || urlDraft).trim();
    if (draft) {
      setMessage(prev => prev.trim() ? prev : draft);
    }

    if (urlDraft) {
      const next = new URLSearchParams(searchParams);
      next.delete('draft');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!conversation && selectedProvider?.default_model) {
      setModel(selectedProvider.default_model);
    }
  }, [conversation, selectedProvider]);

  async function refreshConversations(activeId?: string | null) {
    const payload = await listAiConversations();
    const summaries = payload.data || [];
    setConversations(summaries);
    const id = activeId === undefined
      ? conversation?.id || summaries[0]?.id
      : activeId || summaries[0]?.id;
    if (id) {
      const detail = await getAiConversation(id);
      setConversation(detail.data || null);
    }
  }

  async function handleNewConversation() {
    setLoading(true);
    setError(null);
    try {
      const payload = await createAiConversation({
        title: tx(language, 'Neue Datenbank-Frage', 'New database question'),
        provider,
        model,
      });
      const created = payload.data;
      setConversation(created || null);
      await refreshConversations(created?.id);
    } catch (createError) {
      setError(formatAiChatError(createError, language, {
        provider,
        providerLabel: selectedProvider?.label,
        model,
      }));
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectConversation(id: string) {
    if (!id) {
      setConversation(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = await getAiConversation(id);
      const loaded = payload.data || null;
      setConversation(loaded);
      setProvider(loaded?.provider || provider);
      setModel(loaded?.model || model);
    } catch (selectError) {
      setError(formatAiChatError(selectError, language));
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    const trimmed = message.trim();
    if (!trimmed || sending) return;
    const currentSettings = getAiClientSettings();
    setClientSettings(currentSettings);
    const apiKey = getCredentialForProvider(provider, currentSettings);
    if (!hasLocalCredentials(provider, currentSettings)) {
      setError(tx(
        language,
        'Bitte zuerst den API-Schlüssel unter Einstellungen lokal hinterlegen.',
        'Please add the API key locally in Settings first.'
      ));
      return;
    }

    setSending(true);
    setError(null);
    try {
      let active = conversation;
      if (!active) {
        const created = await createAiConversation({
          title: trimmed.slice(0, 80),
          provider,
          model,
        });
        active = created.data || null;
        setConversation(active);
      }
      if (!active) throw new Error(tx(language, 'Konversation konnte nicht erstellt werden.', 'Could not create conversation.'));

      setMessage('');
      const payload = await sendAiMessage(active.id, {
        message: trimmed,
        provider,
        model,
        credentials: apiKey ? { apiKey } : undefined,
      });
      const updated = payload.data?.conversation || null;
      setConversation(updated);
      if (updated) {
        setProvider(updated.provider);
        setModel(updated.model);
        await refreshConversations(updated.id);
      }
    } catch (sendError) {
      setMessage(trimmed);
      setError(formatAiChatError(sendError, language, {
        provider,
        providerLabel: selectedProvider?.label,
        model,
      }));
    } finally {
      setSending(false);
    }
  }

  async function handleExportMarkdown() {
    if (!conversation) return;
    setError(null);
    try {
      const markdown = await exportAiConversationMarkdown(conversation.id);
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeFileName(conversation.title)}.md`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(formatAiChatError(exportError, language));
    }
  }

  async function handleCopyChat() {
    if (!conversation) return;
    setError(null);
    try {
      await copyTextToClipboard(conversationToPlainText(conversation, language));
      setCopyNote(tx(language, 'Chat kopiert.', 'Chat copied.'));
      window.setTimeout(() => setCopyNote(null), 1800);
    } catch (copyError) {
      setError(formatAiChatError(copyError, language));
    }
  }

  async function handleCopyMarkdown() {
    if (!conversation) return;
    setError(null);
    try {
      const markdown = await exportAiConversationMarkdown(conversation.id);
      await copyTextToClipboard(markdown);
      setCopyNote(tx(language, 'Markdown kopiert.', 'Markdown copied.'));
      window.setTimeout(() => setCopyNote(null), 1800);
    } catch (copyError) {
      setError(formatAiChatError(copyError, language));
    }
  }

  async function handleCopyMessage(chatMessage: AiConversation['messages'][number]) {
    setError(null);
    try {
      await copyTextToClipboard(messageToPlainText(chatMessage, language));
      setCopyNote(tx(language, 'Nachricht kopiert.', 'Message copied.'));
      window.setTimeout(() => setCopyNote(null), 1800);
    } catch (copyError) {
      setError(formatAiChatError(copyError, language));
    }
  }

  async function handleDeleteConversation() {
    if (!conversation) return;
    setLoading(true);
    setError(null);
    try {
      await deleteAiConversation(conversation.id);
      setConversation(null);
      await refreshConversations(null);
    } catch (deleteError) {
      setError(formatAiChatError(deleteError, language));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-toolbar">
        <label>
          <span>{tx(language, 'Gespräch', 'Conversation')}</span>
          <select
            value={conversation?.id || ''}
            onChange={(event) => handleSelectConversation(event.target.value)}
            disabled={loading || sending}
          >
            <option value="">{tx(language, 'Neues Gespräch', 'New conversation')}</option>
            {conversations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title || item.id}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{tx(language, 'Provider', 'Provider')}</span>
          <select
            value={provider}
            onChange={(event) => {
              const next = event.target.value;
              setProvider(next);
              const info = providers.find((entry) => entry.id === next);
              if (info?.default_model) setModel(info.default_model);
            }}
            disabled={sending}
          >
            {providers.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}{hasLocalCredentials(entry.id, clientSettings) ? '' : tx(language, ' (nicht lokal konfiguriert)', ' (not configured locally)')}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{tx(language, 'Modell', 'Model')}</span>
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder={selectedProvider?.default_model || 'model'}
            disabled={sending}
          />
        </label>

        <div className="ai-chat-actions">
          <button type="button" onClick={handleNewConversation} disabled={loading || sending}>
            {tx(language, 'Neu', 'New')}
          </button>
          <button type="button" onClick={handleCopyChat} disabled={!conversation || loading || sending}>
            {tx(language, 'Chat kopieren', 'Copy chat')}
          </button>
          <button type="button" onClick={handleCopyMarkdown} disabled={!conversation || loading || sending}>
            {tx(language, 'Markdown kopieren', 'Copy Markdown')}
          </button>
          <button type="button" onClick={handleExportMarkdown} disabled={!conversation || loading || sending}>
            {tx(language, 'Markdown speichern', 'Save Markdown')}
          </button>
          <button type="button" onClick={handleDeleteConversation} disabled={!conversation || loading || sending}>
            {tx(language, 'Löschen', 'Delete')}
          </button>
        </div>
      </div>

      {!selectedProviderConfigured && provider !== 'ollama' && (
        <div className="info-banner">
          {provider === 'openai'
            ? tx(language, 'OpenAI API-Schlüssel fehlt in den lokalen Einstellungen.', 'OpenAI API key is missing in local settings.')
            : tx(language, 'API-Schlüssel für diesen Provider fehlt in den lokalen Einstellungen.', 'The API key for this provider is missing in local settings.')}
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}
      {copyNote && <div className="info-banner">{copyNote}</div>}

      <div className="ai-chat-layout">
        <aside className="ai-chat-sidebar">
          <div className="ai-chat-sidebar-title">{tx(language, 'Gespeichert', 'Saved')}</div>
          {conversations.length === 0 && (
            <div className="muted">{tx(language, 'Noch keine Gespräche.', 'No conversations yet.')}</div>
          )}
          {conversations.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ai-chat-thread ${conversation?.id === item.id ? 'active' : ''}`}
              onClick={() => handleSelectConversation(item.id)}
            >
              <strong>{item.title || item.id}</strong>
              <span>{item.provider} · {item.message_count} · {formatDate(item.updated_at, language)}</span>
            </button>
          ))}
        </aside>

        <section className="ai-chat-main">
          <div className="ai-chat-messages">
            {loading && <div className="muted">{tx(language, 'Lade...', 'Loading...')}</div>}
            {!loading && (!conversation || conversation.messages.length === 0) && (
              <div className="ai-chat-empty">
                <strong>{tx(language, 'Frage zur Datenbank stellen', 'Ask a database question')}</strong>
                <span>
                  {tx(
                    language,
                    'Beispiel: Welche Scripts haben die meisten Risiken, und womit sollte ich beginnen?',
                    'Example: Which scripts have the most risks, and where should I start?'
                  )}
                </span>
              </div>
            )}
            {conversation?.messages.map((chatMessage) => (
              <article key={chatMessage.id} className={`ai-chat-message ${chatMessage.role}`}>
                <div className="ai-chat-message-meta">
                  <span>{chatMessage.role === 'assistant' ? tx(language, 'Assistent', 'Assistant') : tx(language, 'Du', 'You')}</span>
                  <span className="ai-chat-message-meta-actions">
                    <button type="button" onClick={() => handleCopyMessage(chatMessage)}>
                      {tx(language, 'Kopieren', 'Copy')}
                    </button>
                    <span>{formatDate(chatMessage.created_at, language)}</span>
                  </span>
                </div>
                <div className="ai-chat-message-body">{chatMessage.content}</div>
                {chatMessage.context?.sections?.length ? (
                  <details className="ai-chat-context">
                    <summary>{tx(language, 'Verwendeter Datenbankkontext', 'Database context used')}</summary>
                    <ul>
                      {chatMessage.context.sections.map((section) => (
                        <li key={section.title}>{section.title}: {section.row_count}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            ))}
            {sending && <div className="ai-chat-message assistant pending">{tx(language, 'Antwort wird erstellt...', 'Generating response...')}</div>}
            <div ref={messagesEndRef} />
          </div>

          <div className="ai-chat-composer">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder={tx(
                language,
                'Frage zu Scripts, Layouts, Feldern, TOs, APIs oder Optimierung...',
                'Ask about scripts, layouts, fields, TOs, APIs, or optimization...'
              )}
              disabled={sending}
            />
            <button type="button" onClick={handleSend} disabled={!message.trim() || sending}>
              {tx(language, 'Senden', 'Send')}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
