import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Keypair } from '@solana/web3.js';
import { getOrCreateWallet, shortAddress } from '../utils/wallet';

interface Props {
  onScanPress: () => void;
  onTestPress?: () => void;
  onHistoryPress: () => void;
  onPairPress?: () => void;
}

export default function HomeScreen({ onScanPress, onTestPress, onHistoryPress, onPairPress }: Props) {
  const [wallet, setWallet] = useState<Keypair | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOrCreateWallet()
      .then(setWallet)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#10b981" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="shield-checkmark" size={48} color="#10b981" />
        <Text style={styles.title}>IntentGuard</Text>
        <Text style={styles.subtitle}>Solana 2FA</Text>
      </View>

      {/* Wallet Info */}
      <View style={styles.walletCard}>
        <Text style={styles.walletLabel}>Device Wallet</Text>
        <Text style={styles.walletAddress}>
          {wallet ? shortAddress(wallet.publicKey.toBase58()) : '---'}
        </Text>
        <Text style={styles.walletFull}>
          {wallet?.publicKey.toBase58()}
        </Text>
      </View>

      {/* Scan Button */}
      <TouchableOpacity style={styles.scanButton} onPress={onScanPress}>
        <Ionicons name="qr-code-outline" size={32} color="#fff" />
        <Text style={styles.scanButtonText}>Scan Intent QR</Text>
      </TouchableOpacity>

      <Text style={styles.hint}>
        Scan the QR code shown on your dApp to confirm a transaction
      </Text>

      {/* Test Intent */}
      {onTestPress && (
        <TouchableOpacity style={styles.testButton} onPress={onTestPress}>
          <Ionicons name="flask-outline" size={20} color="#f59e0b" />
          <Text style={styles.testButtonText}>Test Intent (Devnet)</Text>
        </TouchableOpacity>
      )}

      {/* Pair Extension */}
      {onPairPress && (
        <TouchableOpacity style={styles.pairButton} onPress={onPairPress}>
          <Ionicons name="link-outline" size={20} color="#6366f1" />
          <Text style={styles.pairButtonText}>Pair Browser Extension</Text>
        </TouchableOpacity>
      )}

      {/* History */}
      <TouchableOpacity style={styles.historyButton} onPress={onHistoryPress}>
        <Ionicons name="time-outline" size={20} color="#6b7280" />
        <Text style={styles.historyButtonText}>Recent Intents</Text>
      </TouchableOpacity>
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
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginTop: 12,
  },
  subtitle: {
    fontSize: 16,
    color: '#10b981',
    fontWeight: '600',
    marginTop: 4,
  },
  walletCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    alignItems: 'center',
    marginBottom: 32,
    borderWidth: 1,
    borderColor: '#334155',
  },
  walletLabel: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  walletAddress: {
    fontSize: 24,
    color: '#f8fafc',
    fontWeight: 'bold',
    marginTop: 8,
    fontFamily: 'monospace',
  },
  walletFull: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 8,
    fontFamily: 'monospace',
  },
  scanButton: {
    backgroundColor: '#10b981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 36,
    borderRadius: 16,
    width: '100%',
    gap: 12,
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  hint: {
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 20,
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f59e0b',
    width: '100%',
  },
  testButtonText: {
    color: '#f59e0b',
    fontSize: 16,
    fontWeight: '600',
  },
  pairButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#6366f1',
    width: '100%',
  },
  pairButtonText: {
    color: '#6366f1',
    fontSize: 16,
    fontWeight: '600',
  },
  historyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 32,
    padding: 12,
  },
  historyButtonText: {
    color: '#6b7280',
    fontSize: 14,
  },
});
