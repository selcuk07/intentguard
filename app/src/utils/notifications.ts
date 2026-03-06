import { Platform } from 'react-native';
import { WEBHOOK_SERVER_URL } from './constants';

/**
 * Push notification registration and intent tracking.
 *
 * Native: uses expo-notifications + expo-device
 * Web: no-op (notifications not supported)
 */

let cachedPushToken: string | null = null;

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  if (cachedPushToken) return cachedPushToken;

  try {
    const Device = await import('expo-device');
    const Notifications = await import('expo-notifications');

    if (!Device.isDevice) {
      console.log('Push notifications require a physical device');
      return null;
    }

    // Check / request permission
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Push notification permission denied');
      return null;
    }

    // Android notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('intent-updates', {
        name: 'Intent Updates',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#10b981',
      });
    }

    // Get Expo push token
    const tokenResponse = await Notifications.getExpoPushTokenAsync({
      projectId: 'intentguard',
    });
    cachedPushToken = tokenResponse.data;
    return cachedPushToken;
  } catch (err) {
    console.log('Failed to register for push notifications:', err);
    return null;
  }
}

/**
 * Register a committed intent for push notifications.
 * The webhook server will send a notification when the intent is verified or expires.
 */
export async function registerIntentForNotifications(
  wallet: string,
  appId: string,
  intentPda: string,
): Promise<void> {
  const pushToken = await registerForPushNotifications();
  if (!pushToken || !WEBHOOK_SERVER_URL) return;

  try {
    await fetch(`${WEBHOOK_SERVER_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pushToken,
        wallet,
        appId,
        intentPda,
      }),
    });
  } catch {
    // Silent fail — notifications are best-effort
  }
}

/**
 * Configure notification handlers (call once on app start).
 */
export async function setupNotificationHandlers(
  onNotificationReceived?: (notification: any) => void,
): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    const Notifications = await import('expo-notifications');

    // How to display notifications when app is in foreground
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    // Listen for notifications received while app is foregrounded
    if (onNotificationReceived) {
      Notifications.addNotificationReceivedListener(onNotificationReceived);
    }
  } catch {
    // Silent fail
  }
}
