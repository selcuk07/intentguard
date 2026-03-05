import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Connection, Transaction } from '@solana/web3.js';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { getOrCreateWallet, shortAddress } from '../utils/wallet';
import {
  QrIntentPayload,
  computeIntentHash,
  buildCommitInstruction,
} from '../utils/intentguard';
import { DEVNET_RPC, DEFAULT_TTL } from '../utils/constants';
import { PublicKey } from '@solana/web3.js';

interface Props {
  payload: QrIntentPayload;
  onDone: () => void;
  onBack: () => void;
}

type Status = 'preview' | 'authenticating' | 'signing' | 'success' | 'error';

export default function ConfirmScreen({ payload, onDone, onBack }: Props) {
  const [status, setStatus] = useState<Status>('preview');
  const [txSig, setTxSig] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleConfirm = async () => {
    try {
      // Step 1: Biometric authentication
      setStatus('authenticating');
      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Confirm Intent',
        disableDeviceFallback: false,
      });

      if (!authResult.success) {
        setStatus('preview');
        return;
      }

      // Step 2: Sign and send
      setStatus('signing');
      const wallet = await getOrCreateWallet();
      const appId = new PublicKey(payload.app);

      const intentHash = computeIntentHash(
        appId,
        wallet.publicKey,
        payload.action,
        payload.params,
      );

      const ix = buildCommitInstruction(
        wallet.publicKey,
        appId,
        intentHash,
        DEFAULT_TTL,
      );

      const connection = new Connection(DEVNET_RPC, 'confirmed');
      const { blockhash } = await connection.getLatestBlockhash();

      const tx = new Transaction().add(ix);
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet.publicKey;
      tx.sign(wallet);

      const sig = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction(sig, 'confirmed');

      setTxSig(sig);
      setStatus('success');
    } catch (err: unknown) {
      setError((err as Error).message);
      setStatus('error');
    }
  };

  // Preview screen — show intent details for user confirmation
  if (status === 'preview') {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color="#94a3b8" />
        </TouchableOpacity>

        <Ionicons name="shield-checkmark" size={56} color="#10b981" />
        <Text style={styles.title}>Confirm Intent</Text>

        <View style={styles.card}>
          {payload.display && (
            <>
              <Text style={styles.appName}>{payload.display.title}</Text>
              <Text style={styles.description}>{payload.display.description}</Text>
              <View style={styles.divider} />
            </>
          )}

          <DetailRow label="Action" value={payload.action} />
          <DetailRow label="App" value={shortAddress(payload.app)} />

          {Object.entries(payload.params).map(([key, value]) => (
            <DetailRow
              key={key}
              label={key}
              value={typeof value === 'string' && value.length > 20
                ? shortAddress(value)
                : String(value)}
            />
          ))}
        </View>

        <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm}>
          <Ionicons name="finger-print" size={24} color="#fff" />
          <Text style={styles.confirmText}>Confirm with Biometrics</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.rejectBtn} onPress={onBack}>
          <Text style={styles.rejectText}>Reject</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Loading states
  if (status === 'authenticating' || status === 'signing') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#10b981" />
        <Text style={styles.loadingText}>
          {status === 'authenticating' ? 'Authenticating...' : 'Signing & sending...'}
        </Text>
      </View>
    );
  }

  // Success
  if (status === 'success') {
    return (
      <View style={styles.container}>
        <Ionicons name="checkmark-circle" size={72} color="#10b981" />
        <Text style={styles.successTitle}>Intent Committed!</Text>
        <Text style={styles.successSub}>
          Your dApp can now proceed with the transaction.
        </Text>

        <View style={styles.card}>
          <DetailRow label="TX" value={shortAddress(txSig)} />
          <DetailRow label="Status" value="On-chain" highlight />
          <DetailRow label="TTL" value={`${DEFAULT_TTL}s`} />
        </View>

        <TouchableOpacity style={styles.doneBtn} onPress={onDone}>
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Error
  return (
    <View style={styles.container}>
      <Ionicons name="close-circle" size={72} color="#ef4444" />
      <Text style={styles.errorTitle}>Failed</Text>
      <Text style={styles.errorMsg}>{error}</Text>

      <TouchableOpacity style={styles.retryBtn} onPress={() => setStatus('preview')}>
        <Text style={styles.retryText}>Try Again</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.rejectBtn} onPress={onBack}>
        <Text style={styles.rejectText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

function DetailRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, highlight && styles.rowHighlight]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  backBtn: {
    position: 'absolute',
    top: 60,
    left: 24,
    padding: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginTop: 16,
    marginBottom: 24,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 24,
  },
  appName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#f8fafc',
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    color: '#10b981',
    textAlign: 'center',
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  rowLabel: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rowValue: {
    fontSize: 14,
    color: '#f8fafc',
    fontFamily: 'monospace',
    maxWidth: '60%',
    textAlign: 'right',
  },
  rowHighlight: {
    color: '#10b981',
    fontWeight: 'bold',
  },
  confirmBtn: {
    backgroundColor: '#10b981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: 16,
    width: '100%',
    gap: 10,
  },
  confirmText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  rejectBtn: {
    marginTop: 16,
    padding: 12,
  },
  rejectText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 16,
    marginTop: 16,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#10b981',
    marginTop: 16,
  },
  successSub: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  doneBtn: {
    backgroundColor: '#1e293b',
    paddingVertical: 16,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  doneText: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '600',
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ef4444',
    marginTop: 16,
  },
  errorMsg: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  retryBtn: {
    backgroundColor: '#1e293b',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  retryText: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '600',
  },
});
