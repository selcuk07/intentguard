import './src/utils/polyfills';

import React, { useState, useEffect } from 'react';
import { Linking } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import HomeScreen from './src/screens/HomeScreen';
import ScanScreen from './src/screens/ScanScreen';
import ConfirmScreen from './src/screens/ConfirmScreen';
import PairScreen from './src/screens/PairScreen';
import { QrIntentPayload } from './src/utils/intentguard';
import { parseDeepLink } from './src/utils/deeplink';
import { setupNotificationHandlers, registerForPushNotifications } from './src/utils/notifications';

const TEST_PAYLOAD: QrIntentPayload = {
  protocol: 'intentguard',
  version: 1,
  app: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  action: 'swap',
  params: {
    inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    outputMint: 'So11111111111111111111111111111111111111112',
    amount: '100000000',
    slippage: '50',
  },
  display: {
    title: 'Jupiter Swap',
    description: 'Swap 100 USDC for SOL',
  },
};

type Screen = 'home' | 'scan' | 'confirm' | 'pair' | 'pair-scan';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [payload, setPayload] = useState<QrIntentPayload | null>(null);
  const [pairScanCallback, setPairScanCallback] = useState<((data: string) => void) | null>(null);

  // Handle deep links: intentguard://commit?payload=...
  const handleDeepLink = (url: string | null) => {
    if (!url) return;
    const parsed = parseDeepLink(url);
    if (parsed) {
      setPayload(parsed);
      setScreen('confirm');
    }
  };

  useEffect(() => {
    setupNotificationHandlers();
    registerForPushNotifications();

    // Handle deep link that launched the app
    Linking.getInitialURL().then(handleDeepLink);

    // Handle deep links while app is running
    const sub = Linking.addEventListener('url', (e) => handleDeepLink(e.url));
    return () => sub.remove();
  }, []);

  const handleScanned = (p: QrIntentPayload) => {
    setPayload(p);
    setScreen('confirm');
  };

  const handleTestIntent = () => {
    setPayload(TEST_PAYLOAD);
    setScreen('confirm');
  };

  return (
    <>
      <StatusBar style="light" />

      {screen === 'home' && (
        <HomeScreen
          onScanPress={() => setScreen('scan')}
          onTestPress={handleTestIntent}
          onHistoryPress={() => {}}
          onPairPress={() => setScreen('pair')}
        />
      )}

      {screen === 'scan' && (
        <ScanScreen
          onScanned={handleScanned}
          onBack={() => setScreen('home')}
        />
      )}

      {screen === 'confirm' && payload && (
        <ConfirmScreen
          payload={payload}
          onDone={() => { setPayload(null); setScreen('home'); }}
          onBack={() => setScreen('home')}
        />
      )}

      {screen === 'pair' && (
        <PairScreen
          onBack={() => setScreen('home')}
          onScanQr={(callback) => {
            setPairScanCallback(() => callback);
            setScreen('pair-scan');
          }}
        />
      )}

      {screen === 'pair-scan' && (
        <ScanScreen
          onScanned={(payload) => {
            if (pairScanCallback) {
              pairScanCallback(JSON.stringify(payload));
              setPairScanCallback(null);
            }
            setScreen('pair');
          }}
          onBack={() => setScreen('pair')}
        />
      )}
    </>
  );
}
