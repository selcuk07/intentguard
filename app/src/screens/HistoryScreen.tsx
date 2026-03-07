import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getHistory, IntentRecord } from '../utils/history';
import { shortAddress } from '../utils/wallet';

interface Props {
  onBack: () => void;
}

export default function HistoryScreen({ onBack }: Props) {
  const [records, setRecords] = useState<IntentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHistory().then(setRecords).finally(() => setLoading(false));
  }, []);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#94a3b8" />
        </TouchableOpacity>
        <Text style={styles.title}>Recent Intents</Text>
      </View>

      {loading ? (
        <Text style={styles.empty}>Loading...</Text>
      ) : records.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="time-outline" size={48} color="#334155" />
          <Text style={styles.empty}>No intents yet</Text>
          <Text style={styles.emptySub}>Confirmed intents will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name="checkmark-circle" size={20} color="#10b981" />
                <Text style={styles.appName}>{item.appName}</Text>
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.label}>Action</Text>
                <Text style={styles.value}>{item.action}</Text>
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.label}>TX</Text>
                <Text style={styles.valueMono}>{shortAddress(item.signature)}</Text>
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.label}>Time</Text>
                <Text style={styles.value}>{formatTime(item.timestamp)}</Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 20,
    gap: 16,
  },
  backBtn: { padding: 8 },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  list: { padding: 24, gap: 12 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  appName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  label: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  value: {
    fontSize: 13,
    color: '#f8fafc',
  },
  valueMono: {
    fontSize: 13,
    color: '#f8fafc',
    fontFamily: 'monospace',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  empty: {
    color: '#64748b',
    fontSize: 16,
    textAlign: 'center',
  },
  emptySub: {
    color: '#475569',
    fontSize: 13,
    textAlign: 'center',
  },
});
