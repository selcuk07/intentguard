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
 *   />
 *
 * Flow:
 *   1. Button renders "Secure with IntentGuard" + QR code
 *   2. User scans QR on mobile → commits intent
 *   3. Component polls for IntentCommit PDA on-chain
 *   4. When found → calls onVerified with the intent hash
 *   5. dApp adds verify_intent to the transaction
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PublicKey, Connection } from '@solana/web3.js';
import { computeIntentHash, findIntentCommitPda } from './index';

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
  /** Poll interval in ms (default: 2000) */
  pollInterval?: number;
  /** Custom class name */
  className?: string;
}

type GuardState = 'idle' | 'waiting' | 'verified' | 'expired' | 'error';

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
  className,
}: IntentGuardButtonProps) {
  const [state, setState] = useState<GuardState>('idle');
  const [qrData, setQrData] = useState<string>('');
  const [countdown, setCountdown] = useState(ttl);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const intentHash = computeIntentHash([
    appId.toBuffer(),
    userPublicKey.toBuffer(),
    Buffer.from(action),
    Buffer.from(JSON.stringify(params, Object.keys(params).sort())),
  ]);

  const [intentPda] = findIntentCommitPda(userPublicKey, appId);

  const startPolling = useCallback(() => {
    // Generate QR data
    const payload = JSON.stringify({
      protocol: 'intentguard',
      version: 1,
      app: appId.toBase58(),
      action,
      params,
      display: {
        title: `IntentGuard`,
        description: `${action} verification`,
      },
    });
    setQrData(payload);
    setState('waiting');
    setCountdown(ttl);

    // Poll for PDA
    intervalRef.current = setInterval(async () => {
      try {
        const info = await connection.getAccountInfo(intentPda);
        if (info) {
          cleanup();
          setState('verified');
          onVerified(intentHash);
        }
      } catch (err) {
        // RPC errors are transient, keep polling
      }
    }, pollInterval);

    // Countdown
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          cleanup();
          setState('expired');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [appId, action, params, userPublicKey, connection, intentPda, intentHash, onVerified, ttl, pollInterval]);

  const cleanup = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  };

  useEffect(() => () => cleanup(), []);

  const reset = () => {
    cleanup();
    setState('idle');
    setCountdown(ttl);
  };

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
          onClick={startPolling}
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
        <button
          onClick={reset}
          style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '13px', cursor: 'pointer', marginTop: '8px' }}
        >
          Cancel
        </button>
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
          onClick={startPolling}
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

  return null;
}
