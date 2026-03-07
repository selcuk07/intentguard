/**
 * IntentGuardButton — Drop-in React component for dApp integration.
 *
 * Usage:
 *   <IntentGuardButton
 *     appId={JUPITER_PROGRAM_ID}
 *     action="swap"
 *     params={{ amount: "1000000000", inputMint: "So11...", outputMint: "EPjF..." }}
 *     onVerified={(hash) => executeSwap(hash)}
 *     onError={(err) => console.error(err)}
 *     mode="auto" // 'websocket' | 'polling' | 'auto' (default)
 *   />
 *
 * Flow:
 *   1. Button renders "Secure with IntentGuard" + QR code
 *   2. User scans QR on mobile -> commits intent
 *   3. Component detects IntentCommit PDA via WebSocket (or polling fallback)
 *   4. When found -> calls onVerified with the intent hash
 *   5. dApp adds verify_intent to the transaction
 *
 * Detection modes:
 *   - 'websocket': Uses Solana onAccountChange subscription (~400ms latency)
 *   - 'polling': Uses setInterval + getAccountInfo (configurable interval)
 *   - 'auto': Tries WebSocket first, falls back to polling if subscription fails
 */

import React, { useState } from 'react';
import { PublicKey, Connection } from '@solana/web3.js';
import { useIntentGuard, IntentDetectionMode } from './hooks';

export interface IntentGuardButtonProps {
  /** User's wallet public key */
  userPublicKey: PublicKey;
  /** Target app/program ID */
  appId: PublicKey;
  /** Action label (e.g., "swap", "transfer") */
  action: string;
  /** Intent parameters — keys are sorted before hashing */
  params: Record<string, string>;
  /** Solana RPC connection */
  connection: Connection;
  /** Called when intent is verified on-chain */
  onVerified: (intentHash: number[]) => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** TTL in seconds (default: 300) */
  ttl?: number;
  /** Poll interval in ms — only used in polling mode (default: 2000) */
  pollInterval?: number;
  /** Detection mode: 'websocket' | 'polling' | 'auto' (default: 'auto') */
  mode?: IntentDetectionMode;
  /** Show "enter hash manually" link for CLI users (default: true) */
  allowManualHash?: boolean;
  /** Custom class name */
  className?: string;
}

export function IntentGuardButton({
  userPublicKey,
  appId,
  action,
  params,
  connection,
  onVerified,
  onError,
  ttl = 300,
  pollInterval = 2000,
  mode = 'auto',
  allowManualHash = true,
  className,
}: IntentGuardButtonProps) {
  const [manualValue, setManualValue] = useState('');
  const [manualError, setManualError] = useState('');

  const {
    state,
    qrData,
    countdown,
    mode: activeMode,
    start,
    reset,
    showManualInput,
    submitManualHash,
  } = useIntentGuard({
    userPublicKey,
    appId,
    action,
    params,
    connection,
    onVerified,
    onError,
    ttl,
    pollInterval,
    mode,
  });

  // Styles
  const baseStyle: React.CSSProperties = {
    fontFamily: "'Inter', -apple-system, sans-serif",
    borderRadius: '12px',
    padding: '16px 24px',
    border: '1px solid #1f2d47',
    background: '#1a2236',
    color: '#f1f5f9',
    textAlign: 'center',
    minWidth: '280px',
  };

  if (state === 'idle') {
    return (
      <div style={baseStyle} className={className}>
        <button
          onClick={start}
          style={{
            background: '#10b981',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            padding: '12px 24px',
            fontSize: '15px',
            fontWeight: 700,
            cursor: 'pointer',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          &#x1f6e1; Secure with IntentGuard
        </button>
      </div>
    );
  }

  if (state === 'waiting') {
    return (
      <div style={baseStyle} className={className}>
        <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '12px' }}>
          Scan with IntentGuard mobile app
        </div>
        <div
          style={{
            background: '#fff',
            borderRadius: '8px',
            padding: '16px',
            display: 'inline-block',
            marginBottom: '12px',
          }}
        >
          {/* QR placeholder — in production, use a QR library */}
          <div style={{ width: '160px', height: '160px', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#666', fontFamily: 'monospace' }}>
            QR: {qrData.length}B
          </div>
        </div>
        <div style={{ fontSize: '14px', color: '#10b981', fontWeight: 600 }}>
          Waiting for confirmation... ({countdown}s)
        </div>
        <div style={{ fontSize: '11px', color: '#475569', marginTop: '4px' }}>
          {activeMode === 'websocket' ? 'Live detection via WebSocket' : 'Polling every ' + (pollInterval / 1000) + 's'}
        </div>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '8px' }}>
          {allowManualHash && (
            <button
              onClick={() => { setManualValue(''); setManualError(''); showManualInput(); }}
              style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '13px', cursor: 'pointer' }}
            >
              Enter hash manually
            </button>
          )}
          <button
            onClick={reset}
            style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '13px', cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (state === 'manual_input') {
    return (
      <div style={baseStyle} className={className}>
        <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '12px' }}>
          Paste the intent hash from your CLI
        </div>
        <input
          type="text"
          value={manualValue}
          onChange={(e) => { setManualValue(e.target.value); setManualError(''); }}
          placeholder="64-character hex hash"
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '8px',
            border: manualError ? '1px solid #ef4444' : '1px solid #334155',
            background: '#0f172a',
            color: '#f1f5f9',
            fontFamily: 'monospace',
            fontSize: '12px',
            boxSizing: 'border-box',
          }}
        />
        {manualError && (
          <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>{manualError}</div>
        )}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button
            onClick={() => {
              const clean = manualValue.replace(/\s/g, '');
              if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
                setManualError('Hash must be exactly 64 hex characters');
                return;
              }
              if (!submitManualHash(clean)) {
                setManualError('Hash does not match the expected intent');
              }
            }}
            style={{
              flex: 1,
              background: '#10b981',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              padding: '10px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Verify
          </button>
          <button
            onClick={() => { setManualValue(''); setManualError(''); start(); }}
            style={{
              background: '#1e293b',
              color: '#f1f5f9',
              border: '1px solid #334155',
              borderRadius: '8px',
              padding: '10px 16px',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Back
          </button>
        </div>
        <div style={{ fontSize: '11px', color: '#475569', marginTop: '8px' }}>
          Run: intentguard commit --app ... then paste the hash here
        </div>
      </div>
    );
  }

  if (state === 'verified') {
    return (
      <div style={{ ...baseStyle, borderColor: 'rgba(16,185,129,0.3)' }} className={className}>
        <div style={{ fontSize: '24px', marginBottom: '8px' }}>&#x2705;</div>
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#10b981' }}>
          Intent Verified
        </div>
        <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
          Proceed with transaction
        </div>
      </div>
    );
  }

  if (state === 'expired') {
    return (
      <div style={{ ...baseStyle, borderColor: 'rgba(239,68,68,0.3)' }} className={className}>
        <div style={{ fontSize: '15px', color: '#ef4444', fontWeight: 600, marginBottom: '8px' }}>
          Timed out
        </div>
        <button
          onClick={start}
          style={{
            background: '#1e293b',
            color: '#f1f5f9',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '10px 20px',
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          Try Again
        </button>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div style={{ ...baseStyle, borderColor: 'rgba(239,68,68,0.3)' }} className={className}>
        <div style={{ fontSize: '15px', color: '#ef4444', fontWeight: 600, marginBottom: '8px' }}>
          Connection error
        </div>
        <button
          onClick={start}
          style={{
            background: '#1e293b',
            color: '#f1f5f9',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '10px 20px',
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return null;
}
