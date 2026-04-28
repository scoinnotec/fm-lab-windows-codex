import { createApiClient } from '@packages/shared';

// API-Client Singleton
// Hinweis: Die API läuft unter /api Prefix
const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3003';
export const api = createApiClient({
  baseUrl: `${baseUrl}/api`
});
