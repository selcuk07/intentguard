/**
 * Deep link parser for intentguard:// URLs.
 *
 * Supported formats:
 *   intentguard://commit?payload={encodeURIComponent(JSON)}
 *   intentguard://commit?app=...&action=...&params={encodeURIComponent(JSON)}
 */

import { QrIntentPayload } from './intentguard';

/**
 * Parse a deep link URL into a QrIntentPayload.
 * Returns null if the URL is invalid or missing required fields.
 */
export function parseDeepLink(url: string): QrIntentPayload | null {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== 'intentguard:') return null;
    if (parsed.hostname !== 'commit') return null;

    // Format 1: Full payload as single param
    const payloadParam = parsed.searchParams.get('payload');
    if (payloadParam) {
      return validatePayload(JSON.parse(payloadParam));
    }

    // Format 2: Individual params
    const app = parsed.searchParams.get('app');
    const action = parsed.searchParams.get('action');
    const paramsRaw = parsed.searchParams.get('params');

    if (!app || !action || !paramsRaw) return null;

    const params = JSON.parse(paramsRaw);
    if (typeof params !== 'object' || params === null) return null;

    const displayRaw = parsed.searchParams.get('display');
    const display = displayRaw ? JSON.parse(displayRaw) : undefined;

    return validatePayload({
      protocol: 'intentguard',
      version: 1,
      app,
      action,
      params,
      display,
    });
  } catch {
    return null;
  }
}

function validatePayload(data: unknown): QrIntentPayload | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;

  if (obj.protocol !== 'intentguard') return null;
  if (typeof obj.app !== 'string' || obj.app.length < 32) return null;
  if (typeof obj.action !== 'string' || obj.action.length === 0) return null;
  if (typeof obj.params !== 'object' || obj.params === null) return null;

  return {
    protocol: 'intentguard',
    version: typeof obj.version === 'number' ? obj.version : 1,
    app: obj.app,
    action: obj.action,
    params: obj.params as Record<string, string>,
    display: obj.display as QrIntentPayload['display'],
  };
}

/**
 * Build a deep link URL from a QrIntentPayload.
 * Useful for generating links in web UIs or notifications.
 */
export function buildDeepLink(payload: QrIntentPayload): string {
  const encoded = encodeURIComponent(JSON.stringify(payload));
  return `intentguard://commit?payload=${encoded}`;
}
