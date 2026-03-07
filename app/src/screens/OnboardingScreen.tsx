import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  FlatList,
  TouchableOpacity,
  ViewToken,
} from 'react-native';

const { width } = Dimensions.get('window');

interface OnboardingScreenProps {
  onComplete: () => void;
}

interface Step {
  id: string;
  icon: string;
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    id: '1',
    icon: '\u{1F6E1}',
    title: 'Welcome to IntentGuard',
    description:
      'Solana 2FA for your wallet. Confirm every transaction from your phone before it executes — even if your browser is compromised.',
  },
  {
    id: '2',
    icon: '\u{1F4F1}',
    title: 'Device Wallet',
    description:
      'A secure keypair is generated on this device and protected with biometrics. This is your trusted signing device — separate from your browser.',
  },
  {
    id: '3',
    icon: '\u{1F4F7}',
    title: 'Scan & Confirm',
    description:
      'When a dApp needs verification, scan the QR code shown in your browser. Review the transaction details and approve with your fingerprint.',
  },
  {
    id: '4',
    icon: '\u{1F517}',
    title: 'Pair Your Browser',
    description:
      'Connect your browser extension for automatic notifications. When an intent needs approval, you\'ll get a push notification instantly.',
  },
  {
    id: '5',
    icon: '\u{2705}',
    title: 'You\'re Protected',
    description:
      'Any parameter change after your approval — amount, recipient, slippage — will cause the transaction to revert. Your funds stay safe.',
  },
];

export default function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        setCurrentIndex(viewableItems[0].index);
      }
    },
  ).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const isLast = currentIndex === STEPS.length - 1;

  const goNext = () => {
    if (isLast) {
      onComplete();
    } else {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
    }
  };

  const renderStep = ({ item }: { item: Step }) => (
    <View style={styles.slide}>
      <Text style={styles.icon}>{item.icon}</Text>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.description}>{item.description}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={STEPS}
        renderItem={renderStep}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
      />

      {/* Dots */}
      <View style={styles.dots}>
        {STEPS.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === currentIndex && styles.dotActive]}
          />
        ))}
      </View>

      {/* Buttons */}
      <View style={styles.buttons}>
        {!isLast && (
          <TouchableOpacity onPress={onComplete} style={styles.skipBtn}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={goNext} style={styles.nextBtn}>
          <Text style={styles.nextText}>
            {isLast ? 'Get Started' : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    paddingTop: 80,
    paddingBottom: 50,
  },
  slide: {
    width,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  icon: {
    fontSize: 64,
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#f1f5f9',
    textAlign: 'center',
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 24,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 32,
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#334155',
  },
  dotActive: {
    backgroundColor: '#10b981',
    width: 24,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginTop: 32,
  },
  skipBtn: {
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  skipText: {
    color: '#64748b',
    fontSize: 16,
  },
  nextBtn: {
    backgroundColor: '#10b981',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginLeft: 'auto',
  },
  nextText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
