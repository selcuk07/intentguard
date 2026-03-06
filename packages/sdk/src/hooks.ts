/**
 * useIntentGuard — React hook for intent detection with WebSocket and polling modes.
 *
 * WebSocket mode uses Solana's `onAccountChange` subscription for near-instant
 * PDA detection (~400ms). Falls back to polling if WebSocket fails.
 *
 * Usage:
 *   const { state, qrData, countdown, start, reset } = useIntentGuard({
 *     userPublicKey,
 *     appId,
 *     action: 'swap',
 *     params: { amount: '1000000' },
 *     connection,
 *     onVerified: (hash) => executeSwap(hash),
 *     mode: 'auto', // 'websocket' | 'polling' | 'auto'
 *   });
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { PublicKey, Connection } from '@solana/web3.js';
import { computeIntentHash, findIntentCommitPda } from './index';

export type IntentDetectionMode = 'websocket' | 'polling' | 'auto';
export type IntentGuardState = 'idle' | 'waiting' | 'verified' | 'expired' | 'error';

export interface UseIntentGuardOptions {
  userPublicKey: PublicKey;
  appId: PublicKey;
  action: string;
  params: Record<string, string>;
  connection: Connection;
  onVerified: (intentHash: number[]) => void;
  onError?: (error: Error) => void;
  ttl?: number;
  pollInterval?: number;
  mode?: IntentDetectionMode;
}

export interface UseIntentGuardResult {
  state: IntentGuardState;
  qrData: string;
  countdown: number;
  intentHash: number[];
  mode: 'websocket' | 'polling';
  start: () => void;
  reset: () => void;
}

export function useIntentGuard({
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
}: UseIntentGuardOptions): UseIntentGuardResult {
  const [state, setState] = useState<IntentGuardState>('idle');
  const [qrData, setQrData] = useState('');
  const [countdown, setCountdown] = useState(ttl);
  const [activeMode, setActiveMode] = useState<'websocket' | 'polling'>('websocket');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subscriptionRef = useRef<number | null>(null);
  const cleanedUpRef = useRef(false);

  const intentHash = computeIntentHash([
    appId.toBuffer(),
    userPublicKey.toBuffer(),
    Buffer.from(action),
    Buffer.from(JSON.stringify(params, Object.keys(params).sort())),
  ]);

  const [intentPda] = findIntentCommitPda(userPublicKey, appId);

  const cleanup = useCallback(() => {
    if (cleanedUpRef.current) return;
    cleanedUpRef.current = true;

    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (subscriptionRef.current !== null) {
      try {
        connection.removeAccountChangeListener(subscriptionRef.current);
      } catch {
        // WebSocket may already be closed
      }
      subscriptionRef.current = null;
    }
  }, [connection]);

  const onDetected = useCallback(() => {
    cleanup();
    setState('verified');
    onVerified(intentHash);
  }, [cleanup, onVerified, intentHash]);

  const startWebSocket = useCallback(() => {
    try {
      const subId = connection.onAccountChange(
        intentPda,
        (_accountInfo) => {
          onDetected();
        },
        'confirmed',
      );
      subscriptionRef.current = subId;
      setActiveMode('websocket');
      return true;
    } catch {
      return false;
    }
  }, [connection, intentPda, onDetected]);

  const startPolling = useCallback(() => {
    setActiveMode('polling');
    pollRef.current = setInterval(async () => {
      try {
        const info = await connection.getAccountInfo(intentPda);
        if (info) {
          onDetected();
        }
      } catch {
        // Transient RPC errors — keep polling
      }
    }, pollInterval);
  }, [connection, intentPda, pollInterval, onDetected]);

  const startCountdown = useCallback(() => {
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
  }, [cleanup]);

  const start = useCallback(() => {
    cleanedUpRef.current = false;

    const payload = JSON.stringify({
      protocol: 'intentguard',
      version: 1,
      app: appId.toBase58(),
      action,
      params,
      display: {
        title: 'IntentGuard',
        description: `${action} verification`,
      },
    });
    setQrData(payload);
    setState('waiting');
    setCountdown(ttl);

    if (mode === 'websocket' || mode === 'auto') {
      const wsOk = startWebSocket();
      if (!wsOk && mode === 'auto') {
        startPolling();
      } else if (!wsOk) {
        if (onError) onError(new Error('WebSocket subscription failed'));
        setState('error');
        return;
      }
    } else {
      startPolling();
    }

    startCountdown();
  }, [appId, action, params, ttl, mode, startWebSocket, startPolling, startCountdown, onError]);

  const reset = useCallback(() => {
    cleanup();
    cleanedUpRef.current = false;
    setState('idle');
    setCountdown(ttl);
  }, [cleanup, ttl]);

  // Cleanup on unmount
  useEffect(() => () => { cleanedUpRef.current = false; cleanup(); }, [cleanup]);

  return {
    state,
    qrData,
    countdown,
    intentHash,
    mode: activeMode,
    start,
    reset,
  };
}
