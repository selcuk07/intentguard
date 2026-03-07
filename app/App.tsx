import './src/utils/polyfills';

import React, { useState, useEffect } from 'react';
import { Linking } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import HomeScreen from './src/screens/HomeScreen';
import ScanScreen from './src/screens/ScanScreen';
import ConfirmScreen from './src/screens/ConfirmScreen';
import PairScreen from './src/screens/PairScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { QrIntentPayload } from './src/utils/intentguard';
import { parseDeepLink } from './src/utils/deeplink';
import { trackEvent } from './src/utils/analytics';
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

const ONBOARDED_KEY = 'ig_onboarded';

type Screen = 'onboarding' | 'home' | 'scan' | 'confirm' | 'pair' | 'pair-scan' | 'history';

export default function App() {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [payload, setPayload] = useState<QrIntentPayload | null>(null);
  const [pairScanCallback, setPairScanCallback] = useState<((data: string) => void) | null>(null);

  // Handle deep links: intentguard://commit?payload=...
  const handleDeepLink = (url: string | null) => {
    if (!url) return;
    const parsed = parseDeepLink(url);
    if (parsed) {
      trackEvent('deeplink_opened');
      setPayload(parsed);
      setScreen('confirm');
    }
  };

  useEffect(() => {
    setupNotificationHandlers();
    registerForPushNotifications();

    // Check first-run
    const getFlag = Platform.OS === 'web'
      ? Promise.resolve(localStorage.getItem(ONBOARDED_KEY))
      : SecureStore.getItemAsync(ONBOARDED_KEY);
    getFlag.then((val) => {
      trackEvent('app_open');
      setScreen(val === 'true' ? 'home' : 'onboarding');
    });

    // Handle deep link that launched the app
    Linking.getInitialURL().then(handleDeepLink);

    // Handle deep links while app is running
    const sub = Linking.addEventListener('url', (e) => handleDeepLink(e.url));
    return () => sub.remove();
  }, []);

  const completeOnboarding = async () => {
    trackEvent('onboarding_complete');
    if (Platform.OS === 'web') {
      localStorage.setItem(ONBOARDED_KEY, 'true');
    } else {
      await SecureStore.setItemAsync(ONBOARDED_KEY, 'true');
    }
    setScreen('home');
  };

  if (screen === null) return null; // Loading

  const handleScanned = (p: QrIntentPayload) => {
    trackEvent('qr_scanned');
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

      {screen === 'onboarding' && (
        <OnboardingScreen onComplete={completeOnboarding} />
      )}

      {screen === 'home' && (
        <HomeScreen
          onScanPress={() => setScreen('scan')}
          onTestPress={handleTestIntent}
          onHistoryPress={() => setScreen('history')}
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

      {screen === 'history' && (
        <HistoryScreen onBack={() => setScreen('home')} />
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
          rawMode
          onScanned={() => {}}
          onRawScanned={(data) => {
            if (pairScanCallback) {
              pairScanCallback(data);
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
