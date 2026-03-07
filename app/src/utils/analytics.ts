/**
 * Anonymous usage analytics for IntentGuard mobile app.
 *
 * Tracks only aggregate counts — no wallet addresses, no transaction data,
 * no personal information. All data is anonymous and non-identifiable.
 *
 * Events:
 *   - app_open: App launched
 *   - onboarding_complete: User finished onboarding
 *   - qr_scanned: QR code scanned
 *   - intent_confirmed: Intent committed on-chain
 *   - intent_failed: Intent commit failed
 *   - extension_paired: Browser extension paired
 *   - deeplink_opened: Deep link received
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ANALYTICS_KEY = 'ig_analytics';
const SESSION_KEY = 'ig_session_id';

interface AnalyticsData {
  /** Random device ID (not tied to wallet) */
  deviceId: string;
  /** First seen timestamp */
  firstSeen: string;
  /** Event counts */
  counts: Record<string, number>;
}

type EventName =
  | 'app_open'
  | 'onboarding_complete'
  | 'qr_scanned'
  | 'intent_confirmed'
  | 'intent_failed'
  | 'extension_paired'
  | 'deeplink_opened';

let cached: AnalyticsData | null = null;

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function getStore(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function setStore(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value);
  } else {
    await SecureStore.setItemAsync(key, value);
  }
}

async function load(): Promise<AnalyticsData> {
  if (cached) return cached;

  const raw = await getStore(ANALYTICS_KEY);
  if (raw) {
    try {
      cached = JSON.parse(raw);
      return cached!;
    } catch {
      // Corrupted — reset
    }
  }

  cached = {
    deviceId: generateId(),
    firstSeen: new Date().toISOString(),
    counts: {},
  };
  await save();
  return cached;
}

async function save(): Promise<void> {
  if (!cached) return;
  await setStore(ANALYTICS_KEY, JSON.stringify(cached));
}

/**
 * Track an anonymous event (local only, no network).
 */
export async function trackEvent(event: EventName): Promise<void> {
  const data = await load();
  data.counts[event] = (data.counts[event] || 0) + 1;
  await save();
}

/**
 * Get current analytics summary (for debug/display).
 */
export async function getAnalytics(): Promise<AnalyticsData> {
  return load();
}

/**
 * Get the anonymous device ID.
 */
export async function getDeviceId(): Promise<string> {
  const data = await load();
  return data.deviceId;
}
