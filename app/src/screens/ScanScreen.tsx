import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { QrIntentPayload, parseQrPayload } from '../utils/intentguard';

interface Props {
  onScanned: (payload: QrIntentPayload) => void;
  onBack: () => void;
}

export default function ScanScreen({ onScanned, onBack }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Ionicons name="camera-outline" size={48} color="#64748b" />
        <Text style={styles.permText}>Camera access is required to scan QR codes</Text>
        <TouchableOpacity style={styles.permButton} onPress={requestPermission}>
          <Text style={styles.permButtonText}>Grant Camera Access</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;

    const payload = parseQrPayload(data);
    if (payload) {
      setScanned(true);
      onScanned(payload);
    }
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleBarCodeScanned}
      >
        {/* Overlay */}
        <View style={styles.overlay}>
          <TouchableOpacity style={styles.closeButton} onPress={onBack}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>

          <View style={styles.scanFrame}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>

          <Text style={styles.instruction}>
            Point at the IntentGuard QR code
          </Text>
        </View>
      </CameraView>
    </View>
  );
}

const FRAME_SIZE = 250;
const CORNER_SIZE = 30;
const CORNER_WIDTH = 4;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  camera: {
    flex: 1,
    width: '100%',
  },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  closeButton: {
    position: 'absolute',
    top: 60,
    right: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: 8,
  },
  scanFrame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  topLeft: {
    top: 0, left: 0,
    borderTopWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH,
    borderColor: '#10b981',
  },
  topRight: {
    top: 0, right: 0,
    borderTopWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH,
    borderColor: '#10b981',
  },
  bottomLeft: {
    bottom: 0, left: 0,
    borderBottomWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH,
    borderColor: '#10b981',
  },
  bottomRight: {
    bottom: 0, right: 0,
    borderBottomWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH,
    borderColor: '#10b981',
  },
  instruction: {
    color: '#fff',
    fontSize: 16,
    marginTop: 32,
    fontWeight: '600',
  },
  permText: {
    color: '#94a3b8',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 40,
  },
  permButton: {
    backgroundColor: '#10b981',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    marginTop: 24,
  },
  permButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  backButton: {
    marginTop: 16,
    padding: 12,
  },
  backText: {
    color: '#64748b',
    fontSize: 14,
  },
});
