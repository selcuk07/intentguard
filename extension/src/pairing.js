// IntentGuard — Extension ↔ Mobile Pairing
// ECDH P-256 key exchange, AES-256-GCM encrypted WebSocket relay

const PAIRING_STORAGE_KEY = 'ig_paired_devices';
const RELAY_URL_KEY = 'ig_relay_url';
const DEFAULT_RELAY_URL = 'wss://intentshield.xyz';

// ─── Crypto Helpers ──────────────────────────────────────────────────

function arrayBufToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToArrayBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate ECDH P-256 key pair
async function generateKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // non-extractable — private key cannot be exported
    ['deriveKey', 'deriveBits']
  );
}

// Export public key as raw bytes (65 bytes, uncompressed)
async function exportPublicKey(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  return arrayBufToBase64(raw);
}

// Import a raw public key
async function importPublicKey(b64) {
  const raw = base64ToArrayBuf(b64);
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

// Derive AES-256-GCM key from ECDH shared secret via HKDF
async function deriveSharedKey(privateKey, peerPublicKey) {
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

// Encrypt a message with AES-256-GCM
async function encrypt(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(plaintext));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  return {
    iv: arrayBufToBase64(iv),
    data: arrayBufToBase64(ciphertext),
  };
}

// Decrypt a message with AES-256-GCM
async function decrypt(key, envelope) {
  const iv = new Uint8Array(base64ToArrayBuf(envelope.iv));
  const ciphertext = base64ToArrayBuf(envelope.data);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

// ─── Pairing State ──────────────────────────────────────────────────

// Active pairing session (during QR display, before mobile scans)
let pendingPairing = null;

// Active WebSocket connections to paired devices
const activeConnections = new Map(); // deviceId -> { ws, sharedKey }

// ─── Storage ────────────────────────────────────────────────────────

async function getPairedDevices() {
  const data = await chrome.storage.local.get(PAIRING_STORAGE_KEY);
  return data[PAIRING_STORAGE_KEY] || [];
}

async function savePairedDevice(device) {
  const devices = await getPairedDevices();
  // Replace if same deviceId exists
  const filtered = devices.filter(d => d.deviceId !== device.deviceId);
  filtered.push(device);
  await chrome.storage.local.set({ [PAIRING_STORAGE_KEY]: filtered });
}

async function removePairedDevice(deviceId) {
  const devices = await getPairedDevices();
  const filtered = devices.filter(d => d.deviceId !== deviceId);
  await chrome.storage.local.set({ [PAIRING_STORAGE_KEY]: filtered });

  // Close active connection if any
  const conn = activeConnections.get(deviceId);
  if (conn && conn.ws) {
    conn.ws.close();
    activeConnections.delete(deviceId);
  }
}

async function getRelayUrl() {
  const data = await chrome.storage.local.get(RELAY_URL_KEY);
  return data[RELAY_URL_KEY] || DEFAULT_RELAY_URL;
}

// ─── Pairing Flow (Extension side) ─────────────────────────────────

/**
 * Start a new pairing session.
 * Returns QR payload for mobile to scan.
 */
async function startPairing() {
  const keyPair = await generateKeyPair();
  const publicKeyB64 = await exportPublicKey(keyPair.publicKey);
  const channelId = randomId();
  const relayUrl = await getRelayUrl();

  pendingPairing = {
    channelId,
    publicKeyB64,
    privateKey: keyPair.privateKey, // Keep as CryptoKey — never export
    createdAt: Date.now(),
  };

  // QR payload the mobile app will scan
  return {
    protocol: 'intentguard-pair',
    version: 1,
    channelId,
    publicKey: publicKeyB64,
    relay: relayUrl.replace(/^ws/, 'http'), // mobile needs HTTP URL for initial WS upgrade
  };
}

/**
 * Complete pairing after mobile sends its public key via relay.
 * Called when we receive a 'pair_response' message on the channel.
 */
async function completePairing(mobilePublicKeyB64, deviceName, deviceId) {
  if (!pendingPairing) throw new Error('No pending pairing session');

  // Import mobile's public key
  const mobilePublicKey = await importPublicKey(mobilePublicKeyB64);

  // Derive shared AES key using in-memory CryptoKey (never exported)
  const sharedKey = await deriveSharedKey(pendingPairing.privateKey, mobilePublicKey);

  // Store paired device info
  const device = {
    deviceId,
    deviceName: deviceName || 'Mobile Device',
    channelId: pendingPairing.channelId,
    mobilePublicKey: mobilePublicKeyB64,
    extensionPublicKey: pendingPairing.publicKeyB64,
    pairedAt: Date.now(),
  };

  await savePairedDevice(device);

  // We can't store CryptoKey in chrome.storage, so we re-derive on reconnect
  pendingPairing = null;

  return device;
}

// ─── WebSocket Relay Connection ─────────────────────────────────────

/**
 * Connect to relay for a specific channel.
 * Used both during pairing and for ongoing communication.
 */
function connectToRelay(channelId, onMessage) {
  return new Promise(async (resolve, reject) => {
    const relayUrl = await getRelayUrl();
    const wsUrl = `${relayUrl}/relay?channel=${channelId}&role=extension`;

    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      reject(new Error(`WebSocket connect failed: ${err.message}`));
      return;
    }

    ws.onopen = () => resolve(ws);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        onMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onerror = () => reject(new Error('WebSocket error'));
    ws.onclose = () => {
      // Reconnect will be handled by the caller (reconnectDevice)
      // Prevent dangling references
      const entry = [...activeConnections.entries()].find(([, v]) => v.ws === ws);
      if (entry) activeConnections.delete(entry[0]);
    };
  });
}

/**
 * Listen for pairing response on the pending channel.
 * Returns when mobile completes pairing or times out.
 */
async function waitForPairingResponse(timeoutMs = 120000) {
  if (!pendingPairing) throw new Error('No pending pairing session');

  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => {
      pendingPairing = null;
      reject(new Error('Pairing timed out'));
    }, timeoutMs);

    try {
      const ws = await connectToRelay(pendingPairing.channelId, async (msg) => {
        if (msg.type === 'pair_response') {
          clearTimeout(timer);
          try {
            const device = await completePairing(
              msg.publicKey,
              msg.deviceName,
              msg.deviceId
            );

            // Send confirmation back to mobile
            ws.send(JSON.stringify({
              type: 'pair_confirmed',
              deviceId: device.deviceId,
            }));

            // Keep connection alive for this device
            activeConnections.set(device.deviceId, { ws, sharedKey: null });

            // Re-derive shared key for active connection
            await reconnectDevice(device);

            resolve(device);
          } catch (err) {
            reject(err);
          }
        }
      });
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

/**
 * Re-derive shared key and connect WebSocket for a previously paired device.
 */
async function reconnectDevice(device) {
  // We need both keys to derive the shared secret
  // The extension's private key was not persisted — we need to re-pair if lost
  // For reconnection, we use the channelId as a room identifier and
  // perform a fresh ECDH handshake using a reconnect protocol

  const keyPair = await generateKeyPair();
  const publicKeyB64 = await exportPublicKey(keyPair.publicKey);

  return new Promise(async (resolve, reject) => {
    try {
      const ws = await connectToRelay(device.channelId, async (msg) => {
        if (msg.type === 'reconnect_response') {
          try {
            const mobilePublicKey = await importPublicKey(msg.publicKey);
            const sharedKey = await deriveSharedKey(keyPair.privateKey, mobilePublicKey);
            activeConnections.set(device.deviceId, { ws, sharedKey });
            resolve({ ws, sharedKey });
          } catch (err) {
            reject(err);
          }
        }

        if (msg.type === 'encrypted') {
          const conn = activeConnections.get(device.deviceId);
          if (conn && conn.sharedKey) {
            try {
              const decrypted = await decrypt(conn.sharedKey, msg.payload);
              handleDeviceMessage(device.deviceId, decrypted);
            } catch {
              // Decryption failed — ignore
            }
          }
        }
      });

      // Send reconnect request with new ephemeral public key
      ws.send(JSON.stringify({
        type: 'reconnect_request',
        publicKey: publicKeyB64,
        deviceId: device.deviceId,
      }));
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Encrypted Messaging ────────────────────────────────────────────

/**
 * Send an encrypted message to a paired device.
 */
async function sendToDevice(deviceId, message) {
  const conn = activeConnections.get(deviceId);
  if (!conn || !conn.sharedKey || !conn.ws || conn.ws.readyState !== WebSocket.OPEN) {
    throw new Error(`Device ${deviceId} not connected`);
  }

  const encrypted = await encrypt(conn.sharedKey, message);
  conn.ws.send(JSON.stringify({
    type: 'encrypted',
    payload: encrypted,
  }));
}

/**
 * Send intent_needed to all connected devices.
 * Called by the content script when a transaction intercept occurs.
 */
async function notifyIntentNeeded(txDetails) {
  const devices = await getPairedDevices();
  let notified = 0;

  for (const device of devices) {
    const conn = activeConnections.get(device.deviceId);
    if (conn && conn.sharedKey && conn.ws && conn.ws.readyState === WebSocket.OPEN) {
      try {
        await sendToDevice(device.deviceId, {
          type: 'intent_needed',
          method: txDetails.method,
          programIds: txDetails.programIds,
          origin: txDetails.origin,
          timestamp: Date.now(),
        });
        notified++;
      } catch {
        // Device not reachable
      }
    }
  }

  return notified;
}

/**
 * Handle incoming decrypted messages from mobile devices.
 */
function handleDeviceMessage(deviceId, message) {
  if (message.type === 'intent_committed') {
    // Mobile has committed the intent — notify content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'IG_INTENT_COMMITTED',
          deviceId,
          intentPda: message.intentPda,
        });
      }
    });
  }

  if (message.type === 'heartbeat') {
    // Device is alive — update last seen
    updateDeviceLastSeen(deviceId);
  }
}

async function updateDeviceLastSeen(deviceId) {
  const devices = await getPairedDevices();
  const device = devices.find(d => d.deviceId === deviceId);
  if (device) {
    device.lastSeen = Date.now();
    await chrome.storage.local.set({ [PAIRING_STORAGE_KEY]: devices });
  }
}

// ─── Init: reconnect to all paired devices ──────────────────────────

async function initPairing() {
  const devices = await getPairedDevices();
  for (const device of devices) {
    reconnectDevice(device).catch(() => {
      // Device offline — will reconnect later
    });
  }
}

// Export for use in background.js and popup.js
// (In extension context, we attach to globalThis)
if (typeof globalThis !== 'undefined') {
  globalThis.igPairing = {
    startPairing,
    waitForPairingResponse,
    getPairedDevices,
    removePairedDevice,
    notifyIntentNeeded,
    sendToDevice,
    initPairing,
    getRelayUrl,
    activeConnections,
  };
}
