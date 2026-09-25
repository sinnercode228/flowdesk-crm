import { config } from '@/config';
import { createDemoServer, type DemoServer } from '../demo/server';
import { localStorageStateStorage } from '../demo/state';
import { ApiClient } from './client';
import { SessionStore } from './session-store';
import { createHttpTransport } from './transport';

let client: ApiClient | null = null;
let demo: DemoServer | null = null;

/** Lazily created singleton, so nothing touches localStorage during static prerendering. */
export function getApi(): ApiClient {
  if (!client) {
    if (config.apiMode === 'demo') {
      demo = createDemoServer({ storage: localStorageStateStorage(), latency: 180 });
      client = new ApiClient(demo.transport, new SessionStore());
    } else {
      client = new ApiClient(createHttpTransport(config.apiUrl), new SessionStore());
    }
  }
  return client;
}

/** Only available in demo mode. */
export function getDemoServer(): DemoServer | null {
  getApi();
  return demo;
}

export { ApiClient } from './client';
export { ApiError, errorMessage, isApiError } from './errors';
