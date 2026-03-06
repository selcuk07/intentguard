import './src/utils/polyfills';

import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import HomeScreen from './src/screens/HomeScreen';
import ScanScreen from './src/screens/ScanScreen';
import ConfirmScreen from './src/screens/ConfirmScreen';
import { QrIntentPayload } from './src/utils/intentguard';

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

type Screen = 'home' | 'scan' | 'confirm';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [payload, setPayload] = useState<QrIntentPayload | null>(null);

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
