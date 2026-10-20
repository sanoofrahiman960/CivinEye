import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { APP_NAME, TAGLINE } from '../../constants/config';
import { colors, spacing } from '../../theme';

/** Branded screen shown while the saved session is being restored. */
export function SplashScreen() {
  return (
    <View style={styles.container} accessibilityLabel={`${APP_NAME} is loading`}>
      <View style={styles.logo}>
        <Ionicons name="eye" size={56} color={colors.primary} />
      </View>
      <Text style={styles.name}>{APP_NAME}</Text>
      <Text style={styles.tagline}>{TAGLINE}</Text>
      <ActivityIndicator color="#fff" style={{ marginTop: spacing.xxl }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  logo: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  name: { color: '#fff', fontSize: 34, fontWeight: '800', letterSpacing: 0.5 },
  tagline: { color: '#CCFBF1', fontSize: 16, marginTop: spacing.sm, textAlign: 'center' },
});
