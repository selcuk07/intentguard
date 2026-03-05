// IntentGuard Content Script
// Detects Solana dApps and injects IntentGuard status indicator

(function() {
  'use strict';

  const PROGRAM_ID = '4etWfDJNHhjYdv7fuGe236GDPguwUXVk9WhbEpQsPix7';
  const RPC_URL = 'https://api.devnet.solana.com';

  // Detect if page is a Solana dApp (looks for common wallet adapter indicators)
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

  // Inject floating badge
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

    // Click to open extension popup
    badge.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
    });

    // Check for active intents
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
            filters: [{ dataSize: 121 }], // IntentCommit size
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

  // Wait for page to load, then check
  function init() {
    // Small delay to let wallet adapters initialize
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
