import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  parsePairingQr,
  completePairing,
  getPairedExtensions,
  removePairedExtension,
  connectToExtension,
  onIntentNeeded,
  PairedExtension,
} from '../utils/pairing';
import { trackEvent } from '../utils/analytics';

interface Props {
  onBack: () => void;
  onScanQr: (onScanned: (data: string) => void) => void;
}

export default function PairScreen({ onBack, onScanQr }: Props) {
  const [devices, setDevices] = useState<PairedExtension[]>([]);
  const [loading, setLoading] = useState(true);
  const [pairing, setPairing] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);

  useEffect(() => {
    loadDevices();
  }, []);

  async function loadDevices() {
    setLoading(true);
    const list = await getPairedExtensions();
    setDevices(list);
    setLoading(false);
  }

  function handleScanPairingQr() {
    onScanQr(async (rawData: string) => {
      const qrData = parsePairingQr(rawData);
      if (!qrData) {
        Alert.alert('Invalid QR', 'This is not an IntentGuard pairing QR code.');
        return;
      }

      setPairing(true);
      try {
        const result = await completePairing(qrData);

        // Listen for intent_needed messages
        onIntentNeeded((details) => {
          Alert.alert(
            'Intent Needed',
            `${details.origin} wants to sign a transaction (${details.method}).`,
            [{ text: 'Open App', style: 'default' }]
          );
        });

        trackEvent('extension_paired');
        Alert.alert('Paired!', `Connected to extension via ${result.extension.channelId.slice(0, 8)}...`);
        await loadDevices();
      } catch (err: any) {
        Alert.alert('Pairing Failed', err.message);
      } finally {
        setPairing(false);
      }
    });
  }

  async function handleConnect(ext: PairedExtension) {
    setConnecting(ext.channelId);
    try {
      await connectToExtension(ext);
      onIntentNeeded((details) => {
        Alert.alert(
          'Intent Needed',
          `${details.origin} wants to sign a transaction (${details.method}).`,
          [{ text: 'Open App', style: 'default' }]
        );
      });
      Alert.alert('Connected', `Reconnected to ${ext.deviceName}`);
    } catch (err: any) {
      Alert.alert('Connection Failed', err.message);
    } finally {
      setConnecting(null);
    }
  }

  async function handleUnpair(ext: PairedExtension) {
    Alert.alert(
      'Unpair Device',
      `Remove pairing with ${ext.deviceName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair',
          style: 'destructive',
          onPress: async () => {
            await removePairedExtension(ext.channelId);
            await loadDevices();
          },
        },
      ]
    );
  }

  function renderDevice({ item }: { item: PairedExtension }) {
    const isConnecting = connecting === item.channelId;
    const pairedDate = new Date(item.pairedAt).toLocaleDateString();

    return (
      <View style={styles.deviceCard}>
        <View style={styles.deviceInfo}>
          <Ionicons name="desktop-outline" size={24} color="#10b981" />
          <View style={styles.deviceText}>
            <Text style={styles.deviceName}>{item.deviceName}</Text>
            <Text style={styles.deviceMeta}>
              Paired {pairedDate} | {item.channelId.slice(0, 8)}...
            </Text>
          </View>
        </View>
        <View style={styles.deviceActions}>
          <TouchableOpacity
            style={styles.connectBtn}
            onPress={() => handleConnect(item)}
            disabled={isConnecting}
          >
            {isConnecting ? (
              <ActivityIndicator size="small" color="#10b981" />
            ) : (
              <Ionicons name="wifi-outline" size={18} color="#10b981" />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.unpairBtn}
            onPress={() => handleUnpair(item)}
          >
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#f8fafc" />
        </TouchableOpacity>
        <Text style={styles.title}>Device Pairing</Text>
      </View>

      {/* Pair new device */}
      <TouchableOpacity
        style={styles.pairButton}
        onPress={handleScanPairingQr}
        disabled={pairing}
      >
        {pairing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="qr-code-outline" size={24} color="#fff" />
            <Text style={styles.pairButtonText}>Scan Extension QR</Text>
          </>
        )}
      </TouchableOpacity>

      <Text style={styles.hint}>
        Open IntentGuard extension in Chrome, click "Pair Device", then scan the QR code shown.
      </Text>

      {/* Paired devices list */}
      <Text style={styles.sectionTitle}>Paired Extensions</Text>

      {loading ? (
        <ActivityIndicator color="#10b981" style={{ marginTop: 20 }} />
      ) : devices.length === 0 ? (
        <Text style={styles.empty}>No paired extensions</Text>
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(item) => item.channelId}
          renderItem={renderDevice}
          style={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    padding: 24,
    paddingTop: 60,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    gap: 12,
  },
  backBtn: {
    padding: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  pairButton: {
    backgroundColor: '#10b981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 10,
  },
  pairButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  hint: {
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  empty: {
    color: '#475569',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
  },
  list: {
    flex: 1,
  },
  deviceCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#334155',
  },
  deviceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  deviceText: {
    flex: 1,
  },
  deviceName: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600',
  },
  deviceMeta: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2,
  },
  deviceActions: {
    flexDirection: 'row',
    gap: 8,
  },
  connectBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  unpairBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
});
