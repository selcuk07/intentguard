import './src/utils/polyfills';

import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import HomeScreen from './src/screens/HomeScreen';
import ScanScreen from './src/screens/ScanScreen';
import ConfirmScreen from './src/screens/ConfirmScreen';
import { QrIntentPayload } from './src/utils/intentguard';

type Screen = 'home' | 'scan' | 'confirm';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [payload, setPayload] = useState<QrIntentPayload | null>(null);

  const handleScanned = (p: QrIntentPayload) => {
    setPayload(p);
    setScreen('confirm');
  };

  return (
    <>
      <StatusBar style="light" />

      {screen === 'home' && (
        <HomeScreen
          onScanPress={() => setScreen('scan')}
          onHistoryPress={() => {}}
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
    </>
  );
}
