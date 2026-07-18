import createClient from 'openapi-fetch';
import type { paths } from './generated/openapi.js';

export function createCarespacesClient(baseUrl: string) {
  return createClient<paths>({ baseUrl });
}

export type CarespacesClient = ReturnType<typeof createCarespacesClient>;
