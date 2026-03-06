// IntentGuard Extension — Popup Logic

const PROGRAM_ID = '4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7';
const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com';

async function getRpcUrl() {
  const data = await chrome.storage.local.get('rpcUrl');
  return data.rpcUrl || DEFAULT_RPC_URL;
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const CONFIG_SEED = [99, 111, 110, 102, 105, 103]; // "config"
const INTENT_SEED = [105, 110, 116, 101, 110, 116]; // "intent"

// Base58 decode (minimal implementation)
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

function base58Encode(bytes) {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let str = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    str += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    str += BASE58_ALPHABET[digits[i]];
  }
  return str;
}

// SHA-256 for PDA derivation
async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

// Find PDA (simplified — no bump iteration, uses brute force)
async function findPDA(seeds, programId) {
  const programIdBytes = base58Decode(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const seedBuffers = [...seeds, new Uint8Array([bump])];
    const totalLen = seedBuffers.reduce((s, b) => s + b.length, 0) + programIdBytes.length + 1;
    const buffer = new Uint8Array(totalLen);
    let offset = 0;
    for (const seed of seedBuffers) {
      buffer.set(seed, offset);
      offset += seed.length;
    }
    buffer.set(programIdBytes, offset);
    offset += programIdBytes.length;
    buffer[offset] = 'ProgramDerivedAddress'.length; // This is simplified
    // Full PDA derivation requires the exact Solana algorithm
    // For extension MVP, we use RPC to find the account directly
  }
  return null;
}

// RPC helpers
async function rpcCall(method, params) {
  const rpcUrl = await getRpcUrl();
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  return json.result;
}

async function getAccountInfo(pubkey) {
  return rpcCall('getAccountInfo', [pubkey, { encoding: 'base64' }]);
}

// Decode GuardConfig from account data
function decodeGuardConfig(base64Data) {
  const data = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  // Skip 8 byte discriminator
  // admin: 32 bytes (offset 8)
  // is_paused: 1 byte (offset 40)
  // total_commits: 8 bytes LE (offset 41)
  // total_verifies: 8 bytes LE (offset 49)
  const view = new DataView(data.buffer);
  const totalCommits = Number(view.getBigUint64(41, true));
  const totalVerifies = Number(view.getBigUint64(49, true));
  const isPaused = data[40] === 1;
  return { totalCommits, totalVerifies, isPaused };
}

// Decode IntentCommit from account data
function decodeIntentCommit(base64Data) {
  const data = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  // Skip 8 byte discriminator
  // user: 32 bytes (offset 8)
  // app_id: 32 bytes (offset 40)
  // intent_hash: 32 bytes (offset 72)
  // committed_at: i64 (offset 104)
  // expires_at: i64 (offset 112)
  // bump: 1 byte (offset 120)
  const view = new DataView(data.buffer);
  const committedAt = Number(view.getBigInt64(104, true));
  const expiresAt = Number(view.getBigInt64(112, true));
  const hashBytes = data.slice(72, 104);
  const hashHex = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return { committedAt, expiresAt, hashHex };
}

// Format time remaining
function formatTimeRemaining(expiresAt) {
  const now = Math.floor(Date.now() / 1000);
  const diff = expiresAt - now;
  if (diff <= 0) return 'Expired';
  const min = Math.floor(diff / 60);
  const sec = diff % 60;
  return `${min}m ${sec}s remaining`;
}

// Get config PDA address using getProgramAccounts with discriminator filter
async function fetchProtocolStats() {
  try {
    // GuardConfig discriminator: [95, 175, 118, 50, 193, 113, 37, 250]
    const discriminator = btoa(String.fromCharCode(95, 175, 118, 50, 193, 113, 37, 250));
    const result = await rpcCall('getProgramAccounts', [
      PROGRAM_ID,
      {
        encoding: 'base64',
        filters: [
          { memcmp: { offset: 0, bytes: discriminator, encoding: 'base64' } },
        ],
      },
    ]);

    if (result && result.length > 0) {
      const config = decodeGuardConfig(result[0].account.data[0]);
      document.getElementById('totalCommits').textContent = config.totalCommits.toLocaleString();
      document.getElementById('totalVerifies').textContent = config.totalVerifies.toLocaleString();
      document.getElementById('statusDot').className = 'status-dot dot-green';
      document.getElementById('statusText').textContent = config.isPaused ? 'Protocol paused' : 'Connected to devnet';
      if (config.isPaused) {
        document.getElementById('statusDot').className = 'status-dot dot-red';
      }
    }
  } catch (err) {
    document.getElementById('statusDot').className = 'status-dot dot-red';
    document.getElementById('statusText').textContent = 'Connection failed';
  }
}

// Check for pending intent
async function checkIntent(wallet, appId) {
  try {
    // IntentCommit discriminator: [103, 72, 77, 62, 59, 234, 35, 126]
    const discriminator = btoa(String.fromCharCode(103, 72, 77, 62, 59, 234, 35, 126));
    const walletBase64 = btoa(String.fromCharCode(...base58Decode(wallet)));

    const result = await rpcCall('getProgramAccounts', [
      PROGRAM_ID,
      {
        encoding: 'base64',
        filters: [
          { memcmp: { offset: 0, bytes: discriminator, encoding: 'base64' } },
          { memcmp: { offset: 8, bytes: walletBase64, encoding: 'base64' } },
        ],
      },
    ]);

    const section = document.getElementById('resultSection');
    const content = document.getElementById('resultContent');
    section.style.display = 'block';

    if (!result || result.length === 0) {
      content.innerHTML = '<div class="empty">No pending intents found</div>';
      return;
    }

    let html = '';
    for (const item of result) {
      const intent = decodeIntentCommit(item.account.data[0]);
      const now = Math.floor(Date.now() / 1000);
      const isActive = intent.expiresAt > now;

      html += `
        <div class="intent-card">
          <div class="intent-row">
            <span class="intent-label">Status</span>
            <span class="intent-status ${isActive ? 'status-active' : 'status-expired'}">
              ${isActive ? 'Active' : 'Expired'}
            </span>
          </div>
          <div class="intent-row">
            <span class="intent-label">Hash</span>
            <span class="intent-value">${intent.hashHex.slice(0, 16)}...</span>
          </div>
          <div class="intent-row">
            <span class="intent-label">Committed</span>
            <span class="intent-value">${new Date(intent.committedAt * 1000).toLocaleTimeString()}</span>
          </div>
          <div class="intent-row">
            <span class="intent-label">TTL</span>
            <span class="intent-value">${formatTimeRemaining(intent.expiresAt)}</span>
          </div>
          <div class="intent-row">
            <span class="intent-label">PDA</span>
            <span class="intent-value">${item.pubkey.slice(0, 12)}...</span>
          </div>
        </div>
      `;
    }
    content.innerHTML = html;
  } catch (err) {
    const section = document.getElementById('resultSection');
    const content = document.getElementById('resultContent');
    section.style.display = 'block';
    content.textContent = '';
    const errDiv = document.createElement('div');
    errDiv.className = 'empty';
    errDiv.style.color = '#ef4444';
    errDiv.textContent = 'Failed to check intent. Please try again.';
    content.appendChild(errDiv);
  }
}

// Event listeners
document.getElementById('checkBtn').addEventListener('click', () => {
  const wallet = document.getElementById('walletInput').value.trim();
  const appId = document.getElementById('appInput').value.trim();
  if (!wallet) return;
  checkIntent(wallet, appId);
});

// Load saved wallet
chrome.storage.local.get(['wallet', 'appId'], (data) => {
  if (data.wallet) document.getElementById('walletInput').value = data.wallet;
  if (data.appId) document.getElementById('appInput').value = data.appId;
});

// Save wallet on change
document.getElementById('walletInput').addEventListener('change', (e) => {
  chrome.storage.local.set({ wallet: e.target.value.trim() });
});
document.getElementById('appInput').addEventListener('change', (e) => {
  chrome.storage.local.set({ appId: e.target.value.trim() });
});

// Bypass list management
async function loadBypassList() {
  const container = document.getElementById('bypassList');
  const response = await chrome.runtime.sendMessage({ type: 'GET_BYPASS_LIST' });
  const list = response.list || [];

  if (list.length === 0) {
    container.innerHTML = '<div class="empty" style="padding: 8px 0; font-size: 12px; color: #64748b;">No trusted sites</div>';
    return;
  }

  let html = '';
  for (const origin of list) {
    html += `
      <div class="intent-row" style="margin-bottom: 4px;">
        <span class="intent-value" style="font-size: 12px;">${escapeAttr(origin)}</span>
        <button class="btn btn-secondary" style="width: auto; padding: 4px 10px; margin: 0; font-size: 11px;" data-origin="${escapeAttr(origin)}">Remove</button>
      </div>
    `;
  }
  container.innerHTML = html;

  // Add remove handlers
  container.querySelectorAll('button[data-origin]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'REMOVE_BYPASS', origin: btn.dataset.origin });
      loadBypassList();
    });
  });
}

// ─── Device Pairing UI ──────────────────────────────────────────────

async function loadPairedDevices() {
  const container = document.getElementById('pairedDevices');
  const response = await chrome.runtime.sendMessage({ type: 'GET_PAIRED_DEVICES' });
  const devices = response.devices || [];

  if (devices.length === 0) {
    container.innerHTML = '<div class="empty" style="padding: 8px 0; font-size: 12px; color: #64748b;">No paired devices</div>';
    return;
  }

  let html = '';
  for (const device of devices) {
    const pairedDate = new Date(device.pairedAt).toLocaleDateString();
    html += `
      <div class="intent-card" style="padding: 10px 14px; margin-bottom: 6px;">
        <div class="intent-row">
          <span class="intent-label">${device.deviceName || 'Mobile Device'}</span>
          <span class="intent-value" style="font-size: 10px;">${device.channelId.slice(0, 8)}...</span>
        </div>
        <div class="intent-row">
          <span class="intent-value" style="font-size: 10px; color: #64748b;">Paired ${pairedDate}</span>
          <button class="btn btn-secondary" style="width: auto; padding: 3px 8px; margin: 0; font-size: 10px;" data-device-id="${device.deviceId}">Unpair</button>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;

  container.querySelectorAll('button[data-device-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'UNPAIR_DEVICE', deviceId: btn.dataset.deviceId });
      loadPairedDevices();
    });
  });
}

// QR Code rendering (minimal — draws data as text matrix)
function renderQrData(canvas, data) {
  const ctx = canvas.getContext('2d');
  const text = JSON.stringify(data);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Simple text-based QR placeholder
  // In production, use a QR library like qrcode-generator
  ctx.fillStyle = '#000';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Pairing QR Code', canvas.width / 2, 20);

  // Encode as simple blocks pattern from the data hash
  const bytes = new TextEncoder().encode(text);
  const blockSize = 6;
  const cols = Math.floor(canvas.width / blockSize);
  const rows = Math.floor((canvas.height - 40) / blockSize);

  for (let i = 0; i < Math.min(bytes.length * 8, cols * rows); i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = i % 8;
    if (bytes[byteIdx % bytes.length] & (1 << bitIdx)) {
      const x = (i % cols) * blockSize;
      const y = 30 + Math.floor(i / cols) * blockSize;
      ctx.fillRect(x, y, blockSize - 1, blockSize - 1);
    }
  }

  // Also show channel ID for manual entry fallback
  ctx.fillStyle = '#666';
  ctx.font = '8px monospace';
  ctx.fillText(data.channelId.slice(0, 16) + '...', canvas.width / 2, canvas.height - 6);
}

document.getElementById('pairBtn').addEventListener('click', async () => {
  const pairBtn = document.getElementById('pairBtn');
  const qrSection = document.getElementById('pairQrSection');

  pairBtn.disabled = true;
  pairBtn.textContent = 'Generating...';

  try {
    const response = await chrome.runtime.sendMessage({ type: 'START_PAIRING' });
    if (!response.ok) {
      pairBtn.textContent = 'Pair Mobile Device';
      pairBtn.disabled = false;
      return;
    }

    // Show QR code
    const canvas = document.getElementById('pairQrCanvas');
    renderQrData(canvas, response.qrData);
    qrSection.style.display = 'block';
    pairBtn.style.display = 'none';

    // Wait for mobile to scan and pair
    const pairResponse = await chrome.runtime.sendMessage({ type: 'WAIT_PAIRING' });
    qrSection.style.display = 'none';
    pairBtn.style.display = 'block';
    pairBtn.textContent = 'Pair Mobile Device';
    pairBtn.disabled = false;

    if (pairResponse.ok) {
      loadPairedDevices();
    }
  } catch {
    pairBtn.textContent = 'Pair Mobile Device';
    pairBtn.disabled = false;
  }
});

document.getElementById('cancelPairBtn').addEventListener('click', () => {
  document.getElementById('pairQrSection').style.display = 'none';
  const pairBtn = document.getElementById('pairBtn');
  pairBtn.style.display = 'block';
  pairBtn.textContent = 'Pair Mobile Device';
  pairBtn.disabled = false;
});

// Init
fetchProtocolStats();
loadBypassList();
loadPairedDevices();
