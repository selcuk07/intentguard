/**
 * IntentGuard — Mobile Pairing (mobile side)
 *
 * Handles ECDH key exchange, encrypted WebSocket communication
 * with the browser extension via a relay server.
 *
 * Uses @noble/* libraries instead of crypto.subtle (unavailable in React Native).
 */

import { Platform } from 'react-native';
import { p256 } from '@noble/curves/p256';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { gcm } from '@noble/ciphers/aes';

// Use polyfilled crypto.getRandomValues (from react-native-get-random-values)
function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

const PAIRING_STORAGE_KEY = 'ig_paired_extension';

// ─── Crypto Helpers ──────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomId(): string {
  const bytes = randomBytes(16);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

interface KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array; // 65 bytes uncompressed
}

function generateKeyPair(): KeyPair {
  const privateKey = p256.utils.randomPrivateKey();
  const publicKey = p256.getPublicKey(privateKey, false); // uncompressed (65 bytes)
  return { privateKey, publicKey };
}

function exportPublicKey(kp: KeyPair): string {
  return bytesToBase64(kp.publicKey);
}

function deriveSharedKey(privateKey: Uint8Array, peerPublicKeyB64: string): Uint8Array {
  const peerPublicKey = base64ToBytes(peerPublicKeyB64);
  const sharedPoint = p256.getSharedSecret(privateKey, peerPublicKey);
  // sharedPoint is 65 bytes (uncompressed), take x-coordinate (bytes 1..33)
  const sharedSecret = sharedPoint.slice(1, 33);

  // HKDF-SHA256 to derive AES-256 key
  const salt = new TextEncoder().encode('intentguard-pairing-v1');
  const info = new TextEncoder().encode('aes-gcm-key');
  return hkdf(sha256, sharedSecret, salt, info, 32);
}

function encryptMessage(key: Uint8Array, plaintext: any): { iv: string; data: string } {
  const iv = randomBytes(12);
  const encoded = new TextEncoder().encode(JSON.stringify(plaintext));
  const aes = gcm(key, iv);
  const ciphertext = aes.encrypt(encoded);
  return {
    iv: bytesToBase64(iv),
    data: bytesToBase64(ciphertext),
  };
}

function decryptMessage(key: Uint8Array, envelope: { iv: string; data: string }): any {
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.data);
  const aes = gcm(key, iv);
  const plaintext = aes.decrypt(ciphertext);
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

    // Validate relay URL scheme
    const relay = String(parsed.relay);
    if (!/^https?:\/\//i.test(relay)) return null;

    // Validate channelId length
    if (typeof parsed.channelId !== 'string' || parsed.channelId.length > 64) return null;

    // Validate publicKey is base64 and reasonable length
    if (typeof parsed.publicKey !== 'string' || parsed.publicKey.length > 128) return null;

    return parsed as PairingQrData;
  } catch {
    return null;
  }
}

// ─── Pairing Flow (Mobile side) ─────────────────────────────────────

export interface PairingResult {
  extension: PairedExtension;
  sharedKey: Uint8Array;
  ws: WebSocket;
}

/**
 * Complete pairing after scanning extension's QR code.
 */
export async function completePairing(qrData: PairingQrData): Promise<PairingResult> {
  const keyPair = generateKeyPair();
  const publicKeyB64 = exportPublicKey(keyPair);
  const deviceId = randomId();
  const deviceName = Platform.OS === 'web' ? 'Web Browser' : `${Platform.OS} device`;

  // Derive shared key from extension's public key + our private key
  const sharedKey = deriveSharedKey(keyPair.privateKey, qrData.publicKey);

  // Connect to relay
  const relayUrl = qrData.relay.replace(/^http/, 'ws');
  const wsUrl = `${relayUrl}/relay?channel=${qrData.channelId}&role=mobile`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Pairing confirmation timed out')), 30000);

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
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
let activeSharedKey: Uint8Array | null = null;
let intentNeededCallback: ((details: any) => void) | null = null;

export function onIntentNeeded(callback: (details: any) => void): void {
  intentNeededCallback = callback;
}

export async function connectToExtension(extension: PairedExtension): Promise<WebSocket> {
  const keyPair = generateKeyPair();
  const publicKeyB64 = exportPublicKey(keyPair);
  const relayUrl = extension.relayUrl.replace(/^http/, 'ws');
  const wsUrl = `${relayUrl}/relay?channel=${extension.channelId}&role=mobile`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
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

        if (msg.type === 'reconnect_request' && msg.publicKey) {
          activeSharedKey = deriveSharedKey(keyPair.privateKey, msg.publicKey);
        }

        if (msg.type === 'encrypted' && activeSharedKey) {
          const decrypted = decryptMessage(activeSharedKey, msg.payload);

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
  const encrypted = encryptMessage(activeSharedKey, message);
  activeWs.send(JSON.stringify({
    type: 'encrypted',
    payload: encrypted,
  }));
}

export function disconnect(): void {
  if (activeWs) {
    activeWs.close();
    activeWs = null;
  }
  activeSharedKey = null;
}
