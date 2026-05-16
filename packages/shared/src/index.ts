/**
 * Shared Package Index
 * Re-exports all shared functionality for easy imports
 */

// Constants
export * from './constants.js';

// Types (generated from OpenAPI)
export type * from '../generated/types.js';

// API Client
export { ApiClientError, createApiClient } from '../generated/client.js';
export type { ApiClient, ApiClientErrorDetails } from '../generated/client.js';
