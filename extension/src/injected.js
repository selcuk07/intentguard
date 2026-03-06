// IntentGuard — Injected into page context
// Wraps wallet signTransaction calls to enforce 2FA verification
//
// This script runs in the PAGE's JS context (not the content script's isolated world).
// Communication with content script is via window.postMessage.

(function () {
  'use strict';

  const IG_PREFIX = 'intentguard:';
  let pendingRequests = new Map();
  let requestId = 0;

  // Listen for responses from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || !event.data.type) return;

    if (event.data.type === 'IG_SIGN_RESPONSE') {
      const { id, action } = event.data;
      const pending = pendingRequests.get(id);
      if (!pending) return;
      pendingRequests.delete(id);

      if (action === 'allow') {
        pending.resolve();
      } else {
        pending.reject(new Error('Transaction blocked by IntentGuard — no verified intent found'));
      }
    }
  });

  function requestApproval(method, programIds) {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      pendingRequests.set(id, { resolve, reject });

      window.postMessage({
        type: 'IG_SIGN_REQUEST',
        id,
        method,
        programIds,
        origin: window.location.origin,
      }, '*');

      // Timeout after 5 minutes (matches max TTL)
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error('IntentGuard verification timed out'));
        }
      }, 300000);
    });
  }

  // Extract program IDs from a serialized transaction
  function extractProgramIds(tx) {
    try {
      // Transaction object may have instructions with programId
      if (tx && tx.instructions) {
        return tx.instructions
          .map((ix) => ix.programId?.toBase58?.() || ix.programId?.toString?.())
          .filter(Boolean);
      }
      // VersionedTransaction: message.staticAccountKeys + compiledInstructions
      if (tx && tx.message) {
        const keys = tx.message.staticAccountKeys || tx.message.accountKeys || [];
        const ixs = tx.message.compiledInstructions || tx.message.instructions || [];
        return ixs
          .map((ix) => {
            const idx = ix.programIdIndex;
            const key = keys[idx];
            return key?.toBase58?.() || key?.toString?.();
          })
          .filter(Boolean);
      }
    } catch {
      // Can't parse — let it through for safety
    }
    return [];
  }

  function wrapProvider(provider, name) {
    if (!provider || provider.__igWrapped) return;
    provider.__igWrapped = true;

    // Wrap signTransaction
    if (typeof provider.signTransaction === 'function') {
      const original = provider.signTransaction.bind(provider);
      provider.signTransaction = async function (tx) {
        const programIds = extractProgramIds(tx);
        await requestApproval('signTransaction', programIds);
        return original(tx);
      };
    }

    // Wrap signAndSendTransaction
    if (typeof provider.signAndSendTransaction === 'function') {
      const original = provider.signAndSendTransaction.bind(provider);
      provider.signAndSendTransaction = async function (tx, options) {
        const programIds = extractProgramIds(tx);
        await requestApproval('signAndSendTransaction', programIds);
        return original(tx, options);
      };
    }

    // Wrap signAllTransactions
    if (typeof provider.signAllTransactions === 'function') {
      const original = provider.signAllTransactions.bind(provider);
      provider.signAllTransactions = async function (txs) {
        const allPrograms = txs.flatMap((tx) => extractProgramIds(tx));
        const unique = [...new Set(allPrograms)];
        await requestApproval('signAllTransactions', unique);
        return original(txs);
      };
    }
  }

  // Wrap known wallet providers
  function wrapAll() {
    if (window.solana) wrapProvider(window.solana, 'solana');
    if (window.phantom?.solana) wrapProvider(window.phantom.solana, 'phantom');
    if (window.solflare) wrapProvider(window.solflare, 'solflare');
    if (window.backpack?.solana) wrapProvider(window.backpack.solana, 'backpack');
    if (window.glow?.solana) wrapProvider(window.glow.solana, 'glow');
  }

  // Wallets may inject after page load — retry a few times
  wrapAll();
  setTimeout(wrapAll, 1000);
  setTimeout(wrapAll, 3000);
  setTimeout(wrapAll, 5000);

  // Also watch for dynamic wallet injection via proxy on window
  let windowProxy;
  try {
    const knownWallets = ['solana', 'phantom', 'solflare', 'backpack', 'glow'];
    for (const name of knownWallets) {
      let currentValue = window[name];
      Object.defineProperty(window, name, {
        get() { return currentValue; },
        set(val) {
          currentValue = val;
          if (val) {
            setTimeout(() => {
              if (name === 'phantom' && val.solana) wrapProvider(val.solana, 'phantom');
              else wrapProvider(val, name);
            }, 0);
          }
        },
        configurable: true,
      });
    }
  } catch {
    // defineProperty may fail if already defined — fallback to setTimeout approach
  }
})();
