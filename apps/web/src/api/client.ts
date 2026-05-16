import { createApiClient } from '@packages/shared';
import type { ScriptContentSearchResult, TableOccurrenceUsageRow, ObjectUsageRow, CredentialFindingRow, ApiIntegrationRow, ApiIntegrationSummaryRow, LayoutObjectQualityFindingRow, QualityFindingRow, QualityDashboardMetricRow, LocalizationLabelRow, ServerTopCallSummaryRow, ServerTopCallRow, ServerTopCallDashboardRow, ServerTopCallWaitAnalysis } from '../types';

// API-Client Singleton
// Hinweis: Die API läuft unter /api Prefix
const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3003';
export const api = createApiClient({
  baseUrl: `${baseUrl}/api`
});

type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
};

type ApiClientErrorOptions = {
  status?: number;
  code?: string;
  details?: Record<string, unknown>;
  path?: string;
};

export class ApiClientError extends Error {
  status?: number;
  code?: string;
  details?: Record<string, unknown>;
  path?: string;

  constructor(message: string, options: ApiClientErrorOptions = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.path = options.path;
  }
}

export type AiProviderInfo = {
  id: string;
  label: string;
  configured: boolean;
  default_model: string;
  base_url: string;
};

export type AiChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  context?: {
    generated_at?: string;
    sections?: Array<{ title: string; row_count: number }>;
  };
};

export type AiConversationSummary = {
  id: string;
  title: string;
  provider: string;
  model: string;
  created_at: string;
  updated_at: string;
  message_count: number;
};

export type AiConversation = {
  id: string;
  title: string;
  provider: string;
  model: string;
  created_at: string;
  updated_at: string;
  messages: AiChatMessage[];
};

type ScriptContentSearchParams = {
  q: string;
  file?: string;
  folders?: string;
  limit?: number;
  offset?: number;
};

type TableOccurrenceUsageParams = {
  q?: string;
  file?: string;
  unused_only?: boolean;
  limit?: number;
  offset?: number;
};

type ObjectUsageParams = {
  type?: string;
  q?: string;
  file?: string;
  unused_only?: boolean;
  max_usage?: number;
  sort?: 'rare' | 'usage' | 'name';
  limit?: number;
  offset?: number;
};

type CredentialFindingParams = {
  q?: string;
  file?: string;
  category?: string;
  risk?: string;
  secret_only?: boolean;
  limit?: number;
  offset?: number;
};

type ApiIntegrationParams = {
  q?: string;
  file?: string;
  family?: string;
  type?: 'API' | 'External Database' | string;
  risk?: string;
  secret_only?: boolean;
  limit?: number;
  offset?: number;
};

type LayoutObjectQualityParams = {
  q?: string;
  file?: string;
  category?: string;
  severity?: string;
  limit?: number;
  offset?: number;
};

type QualityFindingParams = {
  q?: string;
  file?: string;
  area?: string;
  category?: string;
  severity?: string;
  type?: string;
  limit?: number;
  offset?: number;
};

type ServerTopCallParams = {
  q?: string;
  file?: string;
  object_type?: string;
  matched_only?: boolean;
  min_elapsed_ms?: number;
  limit?: number;
  offset?: number;
};

function buildApiUrl(path: string, params: Record<string, string | number | boolean | undefined>) {
  const url = new URL(`${baseUrl}/api${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function technicalMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || '');
}

async function parseJsonPayload<T>(response: Response, path: string) {
  const text = await response.text();
  let payload: ApiEnvelope<T>;
  try {
    payload = text ? JSON.parse(text) as ApiEnvelope<T> : { success: false };
  } catch {
    payload = {
      success: false,
      error: {
        message: text || `API request failed: ${response.status}`,
        details: { response_text: text.slice(0, 500) },
      },
    };
  }

  if (!response.ok || !payload.success) {
    throw new ApiClientError(payload.error?.message || `API request failed: ${response.status}`, {
      status: response.status,
      code: payload.error?.code,
      details: payload.error?.details,
      path,
    });
  }
  return payload;
}

async function fetchJson<T>(path: string, input: RequestInfo | URL, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    throw new ApiClientError(
      'REST API konnte nicht erreicht werden. Bitte pruefe, ob der lokale API-Server auf Port 3003 laeuft.',
      {
        code: 'NETWORK_ERROR',
        path,
        details: {
          base_url: baseUrl,
          technical_message: technicalMessage(error),
          hint: 'Starte das Projekt mit tools/start-servers.ps1 oder npm run start:win neu.',
        },
      }
    );
  }

  return parseJsonPayload<T>(response, path);
}

async function getJson<T>(path: string, params: Record<string, string | number | boolean | undefined>) {
  return fetchJson<T>(path, buildApiUrl(path, params));
}

async function postJson<T>(path: string, body: unknown) {
  return fetchJson<T>(path, `${baseUrl}/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
}

async function deleteJson<T>(path: string) {
  return fetchJson<T>(path, `${baseUrl}/api${path}`, {
    method: 'DELETE',
  });
}

export async function searchScriptContents(params: ScriptContentSearchParams) {
  return getJson<ScriptContentSearchResult[]>('/search/scripts', params);
}

export async function searchScriptContentsCount(params: Omit<ScriptContentSearchParams, 'limit' | 'offset'>) {
  return getJson<{ count?: number } | { count?: number }[]>('/search/scripts/count', params);
}

export async function getTableOccurrenceUsage(params: TableOccurrenceUsageParams) {
  return getJson<TableOccurrenceUsageRow[]>('/analysis/table-occurrences/usage', params);
}

export async function getTableOccurrenceUsageCount(params: Omit<TableOccurrenceUsageParams, 'limit' | 'offset'>) {
  return getJson<{ count?: number } | { count?: number }[]>('/analysis/table-occurrences/usage/count', params);
}

export async function getObjectUsage(params: ObjectUsageParams) {
  return getJson<ObjectUsageRow[]>('/analysis/objects/usage', params);
}

export async function getObjectUsageCount(params: Omit<ObjectUsageParams, 'limit' | 'offset' | 'sort'>) {
  return getJson<{ count?: number } | { count?: number }[]>('/analysis/objects/usage/count', params);
}

export async function getCredentialFindings(params: CredentialFindingParams) {
  return getJson<CredentialFindingRow[]>('/analysis/credentials', params);
}

export async function getCredentialFindingsCount(params: Omit<CredentialFindingParams, 'limit' | 'offset'>) {
  return getJson<{ count?: number } | { count?: number }[]>('/analysis/credentials/count', params);
}

export async function getApiIntegrations(params: ApiIntegrationParams) {
  return getJson<ApiIntegrationRow[]>('/analysis/api-integrations', params);
}

export async function getApiIntegrationsCount(params: Omit<ApiIntegrationParams, 'limit' | 'offset'>) {
  return getJson<{ count?: number } | { count?: number }[]>('/analysis/api-integrations/count', params);
}

export async function getApiIntegrationSummary(params: ApiIntegrationParams) {
  return getJson<ApiIntegrationSummaryRow[]>('/analysis/api-integrations/summary', params);
}

export async function getLayoutObjectQualityFindings(params: LayoutObjectQualityParams) {
  return getJson<LayoutObjectQualityFindingRow[]>('/analysis/layout-objects/quality', params);
}

export async function getLayoutObjectQualityFindingsCount(params: Omit<LayoutObjectQualityParams, 'limit' | 'offset'>) {
  return getJson<{ count?: number } | { count?: number }[]>('/analysis/layout-objects/quality/count', params);
}

export async function getQualityFindings(params: QualityFindingParams) {
  return getJson<QualityFindingRow[]>('/analysis/quality', params);
}

export async function getQualityFindingsCount(params: Omit<QualityFindingParams, 'limit' | 'offset'>) {
  return getJson<{ count?: number } | { count?: number }[]>('/analysis/quality/count', params);
}

export async function getQualityDashboard(params: { file?: string } = {}) {
  return getJson<QualityDashboardMetricRow[]>('/analysis/quality/dashboard', params);
}

export async function getLocalizationLabels(params: { domain?: string; language?: 'de' | 'en' } = {}) {
  return getJson<LocalizationLabelRow[]>('/localization/labels', params);
}

export async function getServerTopCallSummary(params: ServerTopCallParams) {
  return getJson<ServerTopCallSummaryRow[]>('/analysis/server-logs/top-calls/summary', params);
}

export async function getServerTopCallSummaryCount(params: Omit<ServerTopCallParams, 'limit' | 'offset'>) {
  return getJson<{ count?: number } | { count?: number }[]>('/analysis/server-logs/top-calls/summary/count', params);
}

export async function getServerTopCallRows(params: ServerTopCallParams) {
  return getJson<ServerTopCallRow[]>('/analysis/server-logs/top-calls', params);
}

export async function getServerTopCallRowsCount(params: Omit<ServerTopCallParams, 'limit' | 'offset'>) {
  return getJson<{ count?: number } | { count?: number }[]>('/analysis/server-logs/top-calls/count', params);
}

export async function getServerTopCallDashboard() {
  return getJson<ServerTopCallDashboardRow[]>('/analysis/server-logs/top-calls/dashboard', {});
}

export async function getServerTopCallWaitAnalysis(params: Omit<ServerTopCallParams, 'limit' | 'offset'>) {
  return getJson<ServerTopCallWaitAnalysis>('/analysis/server-logs/top-calls/wait-analysis', params);
}

export async function getAiProviders() {
  return getJson<AiProviderInfo[]>('/ai/providers', {});
}

export async function listAiConversations() {
  return getJson<AiConversationSummary[]>('/ai/conversations', {});
}

export async function createAiConversation(params: { title?: string; provider?: string; model?: string }) {
  return postJson<AiConversation>('/ai/conversations', params);
}

export async function getAiConversation(id: string) {
  return getJson<AiConversation>(`/ai/conversations/${encodeURIComponent(id)}`, {});
}

export async function sendAiMessage(id: string, params: { message: string; provider?: string; model?: string; credentials?: { apiKey?: string } }) {
  return postJson<{
    conversation: AiConversation;
    message: AiChatMessage;
    context?: AiChatMessage['context'];
  }>(`/ai/conversations/${encodeURIComponent(id)}/messages`, params);
}

export async function deleteAiConversation(id: string) {
  return deleteJson<{ deleted: boolean }>(`/ai/conversations/${encodeURIComponent(id)}`);
}

export async function exportAiConversationMarkdown(id: string) {
  const path = `/ai/conversations/${encodeURIComponent(id)}/markdown`;
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api${path}`);
  } catch (error) {
    throw new ApiClientError(
      'REST API konnte nicht erreicht werden. Markdown-Export ist erst moeglich, wenn der lokale API-Server laeuft.',
      {
        code: 'NETWORK_ERROR',
        path,
        details: {
          base_url: baseUrl,
          technical_message: technicalMessage(error),
        },
      }
    );
  }
  if (!response.ok) {
    const text = await response.text();
    throw new ApiClientError(text || `API request failed: ${response.status}`, {
      status: response.status,
      path,
    });
  }
  return response.text();
}

export function getQualityExportUrl(params: Omit<QualityFindingParams, 'limit' | 'offset'>, format: 'raw' | 'markdown') {
  return buildApiUrl('/analysis/quality', {
    ...params,
    format,
    limit: 10000,
    offset: 0,
  });
}
