// IntentGuard Content Script
// Injects wallet interceptor, shows blocking overlay, relays messages

(function() {
  'use strict';

  const PROGRAM_ID = '4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7';
  const RPC_URL = 'https://api.devnet.solana.com';

  // ─── Inject page-level script ──────────────────────────────────────

  function injectScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('src/injected.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  injectScript();

  // ─── Message relay: injected script <-> background ─────────────────

  // Active overlay state
  let activeOverlay = null;
  let activeRequestId = null;
  let pollTimer = null;

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'IG_SIGN_REQUEST') return;

    const { id, method, programIds, origin } = event.data;

    // Ask background to check bypass list and intent status
    const response = await chrome.runtime.sendMessage({
      type: 'CHECK_INTENT',
      programIds,
      origin,
    });

    if (response.action === 'bypass') {
      // Site is on bypass list — allow immediately
      window.postMessage({ type: 'IG_SIGN_RESPONSE', id, action: 'allow' }, '*');
      return;
    }

    if (response.action === 'verified') {
      // Active intent commit exists — allow
      window.postMessage({ type: 'IG_SIGN_RESPONSE', id, action: 'allow' }, '*');
      return;
    }

    // No intent found — show blocking overlay
    activeRequestId = id;
    showOverlay(method, programIds, response.wallet);
  });

  // ─── Blocking Overlay ─────────────────────────────────────────────

  function showOverlay(method, programIds, wallet) {
    removeOverlay();

    const overlay = document.createElement('div');
    overlay.id = 'ig-intercept-overlay';
    overlay.innerHTML = `
      <div class="ig-overlay-backdrop"></div>
      <div class="ig-overlay-card">
        <div class="ig-overlay-header">
          <span class="ig-overlay-shield">&#x1f6e1;</span>
          <span class="ig-overlay-title">IntentGuard 2FA Required</span>
        </div>
        <div class="ig-overlay-body">
          <p class="ig-overlay-desc">
            A transaction requires IntentGuard verification before signing.
          </p>
          <div class="ig-overlay-detail">
            <div class="ig-overlay-row">
              <span class="ig-overlay-label">Method</span>
              <span class="ig-overlay-value">${escapeHtml(method)}</span>
            </div>
            ${programIds.length > 0 ? `
            <div class="ig-overlay-row">
              <span class="ig-overlay-label">Programs</span>
              <span class="ig-overlay-value">${programIds.map(p => escapeHtml(p.slice(0, 8) + '...')).join(', ')}</span>
            </div>` : ''}
          </div>
          <div class="ig-overlay-status" id="ig-overlay-status">
            <div class="ig-overlay-spinner"></div>
            <span>Waiting for intent commit from your trusted device...</span>
          </div>
          <p class="ig-overlay-hint">
            Open your IntentGuard mobile app and scan the QR code to confirm this transaction.
          </p>
        </div>
        <div class="ig-overlay-actions">
          <button class="ig-btn ig-btn-skip" id="ig-btn-skip">Skip 2FA (unsafe)</button>
          <button class="ig-btn ig-btn-bypass" id="ig-btn-bypass">Trust this site</button>
          <button class="ig-btn ig-btn-cancel" id="ig-btn-cancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    activeOverlay = overlay;

    // Button handlers
    document.getElementById('ig-btn-cancel').addEventListener('click', () => {
      respondAndClose('block');
    });

    document.getElementById('ig-btn-skip').addEventListener('click', () => {
      respondAndClose('allow');
    });

    document.getElementById('ig-btn-bypass').addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: 'ADD_BYPASS',
        origin: window.location.origin,
      });
      respondAndClose('allow');
    });

    // Start polling for intent commit
    startPollingForIntent(wallet, programIds);
  }

  function removeOverlay() {
    if (activeOverlay) {
      activeOverlay.remove();
      activeOverlay = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function respondAndClose(action) {
    if (activeRequestId !== null) {
      window.postMessage({ type: 'IG_SIGN_RESPONSE', id: activeRequestId, action }, '*');
      activeRequestId = null;
    }
    removeOverlay();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Poll for Intent Commit PDA ───────────────────────────────────

  function startPollingForIntent(wallet, programIds) {
    if (!wallet) return;

    let attempts = 0;
    const maxAttempts = 150; // 5 minutes at 2s intervals

    pollTimer = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(pollTimer);
        pollTimer = null;
        const status = document.getElementById('ig-overlay-status');
        if (status) {
          status.innerHTML = '<span style="color:#ef4444;">Timed out waiting for intent commit.</span>';
        }
        return;
      }

      try {
        const found = await checkForCommit(wallet);
        if (found) {
          clearInterval(pollTimer);
          pollTimer = null;

          const status = document.getElementById('ig-overlay-status');
          if (status) {
            status.innerHTML = '<span style="color:#10b981;">&#x2705; Intent verified! Proceeding...</span>';
          }

          // Small delay so user sees the success message
          setTimeout(() => respondAndClose('allow'), 800);
        }
      } catch {
        // RPC transient error — keep polling
      }
    }, 2000);
  }

  async function checkForCommit(wallet) {
    // Use getProgramAccounts to find IntentCommit PDAs for this wallet
    // IntentCommit discriminator: [103, 72, 77, 62, 59, 234, 35, 126]
    const discriminator = btoa(String.fromCharCode(103, 72, 77, 62, 59, 234, 35, 126));
    const walletBytes = base58Decode(wallet);
    const walletBase64 = btoa(String.fromCharCode(...walletBytes));

    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getProgramAccounts',
        params: [PROGRAM_ID, {
          encoding: 'base64',
          dataSlice: { offset: 104, length: 16 }, // committed_at + expires_at
          filters: [
            { memcmp: { offset: 0, bytes: discriminator, encoding: 'base64' } },
            { memcmp: { offset: 8, bytes: walletBase64, encoding: 'base64' } },
          ],
        }],
      }),
    });
    const json = await res.json();
    if (!json.result || json.result.length === 0) return false;

    // Check if any are still active (not expired)
    const now = Math.floor(Date.now() / 1000);
    for (const item of json.result) {
      const data = Uint8Array.from(atob(item.account.data[0]), c => c.charCodeAt(0));
      const view = new DataView(data.buffer);
      const expiresAt = Number(view.getBigInt64(8, true)); // offset 8 in sliced data = expires_at
      if (expiresAt > now) return true;
    }
    return false;
  }

  // Minimal base58 decode
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

  // ─── Floating Badge (existing feature) ─────────────────────────────

  function isSolanaDapp() {
    return !!(
      window.solana ||
      window.phantom ||
      window.solflare ||
      document.querySelector('[data-wallet-adapter]') ||
      document.querySelector('button[class*="wallet"]') ||
      document.querySelector('[class*="connect-wallet"]')
    );
  }

  function injectBadge() {
    if (document.getElementById('intentguard-badge')) return;

    const badge = document.createElement('div');
    badge.id = 'intentguard-badge';
    badge.innerHTML = `
      <div class="ig-badge-inner">
        <span class="ig-shield">&#x1f6e1;</span>
        <span class="ig-text">IntentGuard</span>
        <span class="ig-status" id="ig-status-dot"></span>
      </div>
    `;
    document.body.appendChild(badge);

    badge.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
    });

    checkActiveIntents();
  }

  async function checkActiveIntents() {
    const dot = document.getElementById('ig-status-dot');
    if (!dot) return;

    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getProgramAccounts',
          params: [PROGRAM_ID, {
            encoding: 'base64',
            dataSlice: { offset: 0, length: 0 },
            filters: [{ dataSize: 121 }],
          }],
        }),
      });
      const json = await res.json();
      const count = json.result ? json.result.length : 0;

      if (count > 0) {
        dot.classList.add('ig-active');
        dot.title = `${count} active intent(s) on-chain`;
      } else {
        dot.classList.add('ig-idle');
        dot.title = 'No active intents';
      }
    } catch {
      dot.classList.add('ig-error');
      dot.title = 'Cannot reach Solana RPC';
    }
  }

  function init() {
    setTimeout(() => {
      if (isSolanaDapp()) {
        injectBadge();
      }
    }, 2000);
  }

  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
