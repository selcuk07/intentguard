// IntentGuard Extension — Popup Logic

const PROGRAM_ID = '4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7';
const RPC_URL = 'https://api.devnet.solana.com';
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
  const res = await fetch(RPC_URL, {
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
    content.innerHTML = `<div class="empty" style="color: #ef4444;">Error: ${err.message}</div>`;
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

// Init
fetchProtocolStats();
