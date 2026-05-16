/**
 * Auto-generated API Client
 * DO NOT EDIT - Generated from openapi.yaml
 */

import createClient from 'openapi-fetch';
import type { paths } from './types.js';

export type ApiClient = ReturnType<typeof createApiClient>;

export type ApiClientErrorDetails = {
  code: string;
  message: string;
  details?: unknown;
  status?: number;
  raw: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function extractApiErrorDetails(raw: unknown): ApiClientErrorDetails {
  const fallback: ApiClientErrorDetails = {
    code: 'REQUEST_FAILED',
    message: 'Request failed',
    raw,
  };

  if (!isRecord(raw)) {
    return fallback;
  }

  const wrapped = raw.error;
  const source = isRecord(wrapped) ? wrapped : raw;
  const code = stringOrUndefined(source.code) || stringOrUndefined(raw.code) || fallback.code;
  const message = stringOrUndefined(source.message) || stringOrUndefined(raw.message) || fallback.message;
  const details = source.details ?? raw.details;
  const status = numberOrUndefined(source.status) || numberOrUndefined(raw.status);

  return { code, message, details, status, raw };
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly status?: number;
  readonly raw: unknown;

  constructor(raw: unknown) {
    const parsed = extractApiErrorDetails(raw);
    super(parsed.message);
    this.name = 'ApiClientError';
    this.code = parsed.code;
    this.details = parsed.details;
    this.status = parsed.status;
    this.raw = parsed.raw;
  }
}

function throwApiClientError(error: unknown): never {
  throw new ApiClientError(error);
}

/**
 * Create a type-safe API client instance
 *
 * @example
 * const api = createApiClient({ baseUrl: 'http://localhost:3003' });
 * const { data } = await api.GET('/get', { params: { query: { uuid: 'ABC-123' } } });
 */
export function createApiClient(options: { baseUrl: string }) {
  const client = createClient<paths>({ baseUrl: options.baseUrl });

  return {
    /**
     * Raw fetch client (for advanced usage)
     */
    client,

    /**
     * Get object by UUID
     */
    async get(params: paths['/get']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/get', {
        params: { query: params }
      });
      if (error) throwApiClientError(error);
      return data;
    },

    /**
     * List objects by type
     */
    async list(params: paths['/list']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/list', {
        params: { query: params }
      });
      if (error) throwApiClientError(error);
      return data;
    },

    /**
     * Search objects by name
     */
    async search(params: paths['/search']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/search', {
        params: { query: params }
      });
      if (error) throwApiClientError(error);
      return data;
    },

    /**
     * Count search results by name pattern
     */
    async searchCount(params: paths['/search/count']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/search/count', {
        params: { query: params }
      });
      if (error) throwApiClientError(error);
      return data;
    },

    /**
     * Count objects
     */
    async count(params: paths['/count']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/count', {
        params: { query: params }
      });
      if (error) throwApiClientError(error);
      return data;
    },

    /**
     * Get object references
     */
    async references(params: paths['/references']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/references', {
        params: { query: params }
      });
      if (error) throwApiClientError(error);
      return data;
    },

    /**
     * Execute custom SQL template (GET)
     */
    async query(params: paths['/query']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/query', {
        params: { query: params }
      });
      if (error) throwApiClientError(error);
      return data;
    },

    /**
     * Execute custom SQL template (POST)
     */
    async queryPost(body: paths['/query']['post']['requestBody']['content']['application/json']) {
      const { data, error } = await client.POST('/query', { body });
      if (error) throwApiClientError(error);
      return data;
    },

    /**
     * Execute report template (GET)
     */
    async report(params: paths['/report']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/report', {
        params: { query: params }
      });
      if (error) throwApiClientError(error);
      return data;
    },

    /**
     * Execute report template (POST)
     */
    async reportPost(body: paths['/report']['post']['requestBody']['content']['application/json']) {
      const { data, error } = await client.POST('/report', { body });
      if (error) throwApiClientError(error);
      return data;
    },

    /**
     * Get API version and health
     */
    async version() {
      const { data, error } = await client.GET('/version');
      if (error) throwApiClientError(error);
      return data;
    },

    /**
     * Get solution information
     */
    async info(params?: paths['/info']['get']['parameters']['query']) {
      const { data, error } = await client.GET('/info', {
        params: { query: params || {} }
      });
      if (error) throwApiClientError(error);
      return data;
    },
  };
}
