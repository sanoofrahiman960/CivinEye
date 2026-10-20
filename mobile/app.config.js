/**
 * CivicEye app configuration.
 * Secrets and per-environment values come from environment variables (see .env.example),
 * so nothing sensitive is committed. Plain JavaScript (not TypeScript) so every Expo CLI can load it.
 *
 * @type {import('expo/config').ExpoConfig}
 */
const fs = require('fs');
const path = require('path');

// Firebase config for Android push notifications (FCM). Used only when the file is present,
// so builds without Firebase keep working. Override the path with GOOGLE_SERVICES_JSON (e.g. an EAS file secret).
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
const hasGoogleServices = fs.existsSync(path.resolve(__dirname, googleServicesFile));

const config = {
  name: 'CivicEye',
  slug: 'civiceye',
  scheme: 'civiceye',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: true,
    bundleIdentifier: process.env.IOS_BUNDLE_ID ?? 'com.civiceye.app',
  },
  android: {
    package: process.env.ANDROID_PACKAGE ?? 'com.civiceye.app',
    ...(hasGoogleServices ? { googleServicesFile } : {}),
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: { favicon: './assets/favicon.png' },
  plugins: [
    'expo-secure-store',
    'expo-sharing',
    'expo-image',
    [
      'expo-camera',
      {
        cameraPermission: 'CivicEye uses the camera to photograph civic issues and the repaired result.',
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'CivicEye lets you attach existing photos of a civic issue.',
        cameraPermission: 'CivicEye uses the camera to photograph civic issues.',
        microphonePermission: false,
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'CivicEye attaches the exact location of the issue you report so the right department can find it.',
      },
    ],
    ['expo-notifications', { color: '#0F766E', defaultChannel: 'default' }],
    [
      'react-native-maps',
      {
        androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY,
        iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY,
      },
    ],
  ],
  extra: {
    // Android builds crash on any map without a Google Maps key; the app shows a notice instead when this is false.
    googleMapsConfigured: Boolean(process.env.GOOGLE_MAPS_ANDROID_API_KEY),
    // Filled in by `npx eas-cli init`; needed for Expo push tokens in development and production builds.
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
};

module.exports = config;
