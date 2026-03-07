/**
 * IntentGuard — Mobile Pairing (mobile side)
 *
 * Handles ECDH key exchange, encrypted WebSocket communication
 * with the browser extension via a relay server.
 */

import { Platform } from 'react-native';

const PAIRING_STORAGE_KEY = 'ig_paired_extension';

// ─── Crypto Helpers ──────────────────────────────────────────────────

function arrayBufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuf(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
}

async function exportPublicKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return arrayBufToBase64(raw);
}

async function importPublicKey(b64: string): Promise<CryptoKey> {
  const raw = base64ToArrayBuf(b64);
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

async function deriveSharedKey(privateKey: CryptoKey, peerPublicKey: CryptoKey): Promise<CryptoKey> {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    256
  );

  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedBits,
    'HKDF',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('intentguard-pairing-v1'),
      info: new TextEncoder().encode('aes-gcm-key'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptMessage(key: CryptoKey, plaintext: any): Promise<{ iv: string; data: string }> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encoded = new TextEncoder().encode(JSON.stringify(plaintext));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as any },
    key,
    encoded as any
  );
  return {
    iv: arrayBufToBase64(iv.buffer as ArrayBuffer),
    data: arrayBufToBase64(ciphertext),
  };
}

async function decryptMessage(key: CryptoKey, envelope: { iv: string; data: string }): Promise<any> {
  const iv = new Uint8Array(base64ToArrayBuf(envelope.iv));
  const ciphertext = base64ToArrayBuf(envelope.data);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as any },
    key,
    ciphertext
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

// ─── Storage ────────────────────────────────────────────────────────

export interface PairedExtension {
  channelId: string;
  extensionPublicKey: string;
  deviceId: string;
  deviceName: string;
  pairedAt: number;
  relayUrl: string;
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key);
  }
  const SecureStore = await import('expo-secure-store');
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value);
    return;
  }
  const SecureStore = await import('expo-secure-store');
  await SecureStore.setItemAsync(key, value);
}

async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(key);
    return;
  }
  const SecureStore = await import('expo-secure-store');
  await SecureStore.deleteItemAsync(key);
}

export async function getPairedExtensions(): Promise<PairedExtension[]> {
  const raw = await getItem(PAIRING_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function savePairedExtension(ext: PairedExtension): Promise<void> {
  const existing = await getPairedExtensions();
  const filtered = existing.filter(e => e.channelId !== ext.channelId);
  filtered.push(ext);
  await setItem(PAIRING_STORAGE_KEY, JSON.stringify(filtered));
}

export async function removePairedExtension(channelId: string): Promise<void> {
  const existing = await getPairedExtensions();
  const filtered = existing.filter(e => e.channelId !== channelId);
  await setItem(PAIRING_STORAGE_KEY, JSON.stringify(filtered));
}

// ─── Pairing QR Data ────────────────────────────────────────────────

export interface PairingQrData {
  protocol: 'intentguard-pair';
  version: number;
  channelId: string;
  publicKey: string;
  relay: string;
}

export function parsePairingQr(data: string): PairingQrData | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed.protocol !== 'intentguard-pair') return null;
    if (!parsed.channelId || !parsed.publicKey || !parsed.relay) return null;

    // Validate relay URL scheme — reject javascript:, data:, file:, etc
    const relay = String(parsed.relay);
    if (!/^https?:\/\//i.test(relay)) return null;

    // Validate channelId length (hex string, max 64 chars)
    if (typeof parsed.channelId !== 'string' || parsed.channelId.length > 64) return null;

    // Validate publicKey is base64 and reasonable length (65 bytes = ~88 chars base64)
    if (typeof parsed.publicKey !== 'string' || parsed.publicKey.length > 128) return null;

    return parsed as PairingQrData;
  } catch {
    return null;
  }
}

// ─── Pairing Flow (Mobile side) ─────────────────────────────────────

export interface PairingResult {
  extension: PairedExtension;
  sharedKey: CryptoKey;
  ws: WebSocket;
}

/**
 * Complete pairing after scanning extension's QR code.
 * Generates our ECDH keypair, sends public key to extension via relay,
 * waits for confirmation.
 */
export async function completePairing(qrData: PairingQrData): Promise<PairingResult> {
  const keyPair = await generateKeyPair();
  const publicKeyB64 = await exportPublicKey(keyPair.publicKey);
  const deviceId = randomId();
  const deviceName = Platform.OS === 'web' ? 'Web Browser' : `${Platform.OS} device`;

  // Derive shared key from extension's public key + our private key
  const extensionPublicKey = await importPublicKey(qrData.publicKey);
  const sharedKey = await deriveSharedKey(keyPair.privateKey, extensionPublicKey);

  // Connect to relay
  const relayUrl = qrData.relay.replace(/^http/, 'ws');
  const wsUrl = `${relayUrl}/relay?channel=${qrData.channelId}&role=mobile`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Pairing confirmation timed out')), 30000);

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      // Send our public key to extension
      ws.send(JSON.stringify({
        type: 'pair_response',
        publicKey: publicKeyB64,
        deviceName,
        deviceId,
      }));
    };

    ws.onmessage = async (event: any) => {
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : '');

        if (msg.type === 'pair_confirmed') {
          clearTimeout(timer);

          const extension: PairedExtension = {
            channelId: qrData.channelId,
            extensionPublicKey: qrData.publicKey,
            deviceId,
            deviceName,
            pairedAt: Date.now(),
            relayUrl: qrData.relay,
          };

          await savePairedExtension(extension);
          resolve({ extension, sharedKey, ws });
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('WebSocket connection failed'));
    };
  });
}

// ─── Encrypted Communication ────────────────────────────────────────

let activeWs: WebSocket | null = null;
let activeSharedKey: CryptoKey | null = null;
let intentNeededCallback: ((details: any) => void) | null = null;

/**
 * Set callback for when extension sends an intent_needed message.
 */
export function onIntentNeeded(callback: (details: any) => void): void {
  intentNeededCallback = callback;
}

/**
 * Connect to relay and listen for encrypted messages from extension.
 */
export async function connectToExtension(extension: PairedExtension): Promise<WebSocket> {
  const keyPair = await generateKeyPair();
  const publicKeyB64 = await exportPublicKey(keyPair.publicKey);
  const relayUrl = extension.relayUrl.replace(/^http/, 'ws');
  const wsUrl = `${relayUrl}/relay?channel=${extension.channelId}&role=mobile`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      // Send reconnect with fresh ephemeral key
      ws.send(JSON.stringify({
        type: 'reconnect_response',
        publicKey: publicKeyB64,
        deviceId: extension.deviceId,
      }));
      activeWs = ws;
      resolve(ws);

      // Start heartbeat
      const heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN && activeSharedKey) {
          sendEncrypted({ type: 'heartbeat' }).catch(() => {});
        } else if (ws.readyState !== WebSocket.OPEN) {
          clearInterval(heartbeatTimer);
        }
      }, 30000);
    };

    ws.onmessage = async (event: any) => {
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : '');

        // Handle reconnect handshake from extension
        if (msg.type === 'reconnect_request' && msg.publicKey) {
          const extPublicKey = await importPublicKey(msg.publicKey);
          activeSharedKey = await deriveSharedKey(keyPair.privateKey, extPublicKey);
        }

        // Handle encrypted messages
        if (msg.type === 'encrypted' && activeSharedKey) {
          const decrypted = await decryptMessage(activeSharedKey, msg.payload);

          if (decrypted.type === 'intent_needed' && intentNeededCallback) {
            intentNeededCallback(decrypted);
          }
        }
      } catch {
        // Ignore malformed or undecryptable messages
      }
    };

    ws.onerror = () => reject(new Error('Connection failed'));
  });
}

/**
 * Send encrypted intent_committed message to extension.
 */
export async function notifyIntentCommitted(intentPda: string): Promise<void> {
  await sendEncrypted({
    type: 'intent_committed',
    intentPda,
    timestamp: Date.now(),
  });
}

async function sendEncrypted(message: any): Promise<void> {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) {
    throw new Error('Not connected to extension');
  }
  if (!activeSharedKey) {
    throw new Error('Shared key not established');
  }
  const encrypted = await encryptMessage(activeSharedKey, message);
  activeWs.send(JSON.stringify({
    type: 'encrypted',
    payload: encrypted,
  }));
}

/**
 * Disconnect from relay.
 */
export function disconnect(): void {
  if (activeWs) {
    activeWs.close();
    activeWs = null;
  }
  activeSharedKey = null;
}
