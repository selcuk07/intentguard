import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface IntentRecord {
  id: string;
  appName: string;
  action: string;
  signature: string;
  timestamp: number;
}

const HISTORY_KEY = 'ig_history';
const MAX_RECORDS = 50;

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') { localStorage.setItem(key, value); return; }
  await SecureStore.setItemAsync(key, value);
}

export async function getHistory(): Promise<IntentRecord[]> {
  try {
    const raw = await getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function addToHistory(record: IntentRecord): Promise<void> {
  const history = await getHistory();
  history.unshift(record);
  if (history.length > MAX_RECORDS) history.length = MAX_RECORDS;
  await setItem(HISTORY_KEY, JSON.stringify(history));
}
