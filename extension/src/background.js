// IntentGuard Background Service Worker
// Handles intent checks, bypass list management, badge state, and pairing

importScripts('pairing.js');

const PROGRAM_ID = '4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7';
const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com';

async function getRpcUrl() {
  const data = await chrome.storage.local.get('rpcUrl');
  return data.rpcUrl || DEFAULT_RPC_URL;
}

// Base58 decode
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Decode(str) {
  const bytes = [0];
  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base58');
    let carry = idx;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of str) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

// Check for active intent commit for a wallet
async function hasActiveIntent(wallet) {
  if (!wallet) return false;

  try {
    const discriminator = btoa(String.fromCharCode(103, 72, 77, 62, 59, 234, 35, 126));
    const walletBytes = base58Decode(wallet);
    const walletBase64 = btoa(String.fromCharCode(...walletBytes));

    const rpcUrl = await getRpcUrl();
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getProgramAccounts',
        params: [PROGRAM_ID, {
          encoding: 'base64',
          dataSlice: { offset: 104, length: 16 },
          filters: [
            { memcmp: { offset: 0, bytes: discriminator, encoding: 'base64' } },
            { memcmp: { offset: 8, bytes: walletBase64, encoding: 'base64' } },
          ],
        }],
      }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'RPC error');
    if (!json.result || json.result.length === 0) return false;

    const now = Math.floor(Date.now() / 1000);
    for (const item of json.result) {
      const data = Uint8Array.from(atob(item.account.data[0]), c => c.charCodeAt(0));
      const view = new DataView(data.buffer);
      const expiresAt = Number(view.getBigInt64(8, true));
      if (expiresAt > now) return true;
    }
  } catch {
    // RPC error — fail-closed: block transaction until RPC is reachable
    return false;
  }
  return false;
}

// Check if origin is on the bypass list
async function isBypassed(origin) {
  const data = await chrome.storage.local.get('bypassList');
  const list = data.bypassList || [];
  return list.includes(origin);
}

// Add origin to bypass list
const MAX_BYPASS_LIST_SIZE = 50;

async function addBypass(origin) {
  const data = await chrome.storage.local.get('bypassList');
  const list = data.bypassList || [];
  if (list.length >= MAX_BYPASS_LIST_SIZE) {
    throw new Error('Bypass list full. Remove some sites first.');
  }
  if (!list.includes(origin)) {
    list.push(origin);
    await chrome.storage.local.set({ bypassList: list });
  }
}

// Remove origin from bypass list
async function removeBypass(origin) {
  const data = await chrome.storage.local.get('bypassList');
  const list = (data.bypassList || []).filter((o) => o !== origin);
  await chrome.storage.local.set({ bypassList: list });
}

// Message handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OPEN_POPUP') {
    chrome.action.openPopup();
    return;
  }

  if (msg.type === 'CHECK_INTENT') {
    (async () => {
      // Check bypass list first
      if (await isBypassed(msg.origin)) {
        sendResponse({ action: 'bypass' });
        return;
      }

      // Get stored wallet
      const data = await chrome.storage.local.get('wallet');
      const wallet = data.wallet;

      if (!wallet) {
        // No wallet configured — can't check, show overlay
        sendResponse({ action: 'no_wallet', wallet: null });
        return;
      }

      // Check for active intent
      const verified = await hasActiveIntent(wallet);
      sendResponse({
        action: verified ? 'verified' : 'no_intent',
        wallet,
      });
    })();
    return true; // Keep message channel open for async response
  }

  if (msg.type === 'ADD_BYPASS') {
    (async () => {
      try {
        await addBypass(msg.origin);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === 'REMOVE_BYPASS') {
    removeBypass(msg.origin);
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'GET_BYPASS_LIST') {
    chrome.storage.local.get('bypassList', (data) => {
      sendResponse({ list: data.bypassList || [] });
    });
    return true;
  }

  // ─── Pairing messages ─────────────────────────────────────────────

  if (msg.type === 'START_PAIRING') {
    (async () => {
      try {
        const qrData = await globalThis.igPairing.startPairing();
        sendResponse({ ok: true, qrData });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === 'WAIT_PAIRING') {
    (async () => {
      try {
        const device = await globalThis.igPairing.waitForPairingResponse();
        sendResponse({ ok: true, device });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === 'GET_PAIRED_DEVICES') {
    (async () => {
      const devices = await globalThis.igPairing.getPairedDevices();
      sendResponse({ devices });
    })();
    return true;
  }

  if (msg.type === 'UNPAIR_DEVICE') {
    (async () => {
      await globalThis.igPairing.removePairedDevice(msg.deviceId);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === 'NOTIFY_INTENT_NEEDED') {
    (async () => {
      const notified = await globalThis.igPairing.notifyIntentNeeded(msg.txDetails);
      sendResponse({ notified });
    })();
    return true;
  }
});

// Set badge on install + init pairing connections
chrome.runtime.onInstalled.addListener(() => {
  console.log('IntentGuard extension installed');
  chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  globalThis.igPairing.initPairing();
});

// Reconnect paired devices when service worker starts
globalThis.igPairing.initPairing();
