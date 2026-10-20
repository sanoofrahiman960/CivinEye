import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../components/ui';
import { APP_NAME, TAGLINE } from '../../constants/config';
import type { AuthScreenProps } from '../../navigation/types';
import { colors, spacing, typography, type IconName } from '../../theme';

export const ONBOARDING_KEY = 'civiceye.onboardingDone';

const SLIDES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'camera', title: 'Report it', text: 'Snap a photo of a pothole, garbage pile or broken streetlight. We attach the exact location for you.' },
  { icon: 'git-network', title: 'Track it', text: 'See who is handling your complaint, every status change and when the work is due.' },
  { icon: 'shield-checkmark', title: 'Verify the fix', text: 'Compare before and after photos. Confirm the fix, or reopen it if the problem is still there.' },
  { icon: 'people', title: 'Improve your community', text: 'Say "this affects me too" instead of filing duplicates, and help your city fix what matters most.' },
];

export function OnboardingScreen({ navigation }: AuthScreenProps<'Onboarding'>) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList>(null);
  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) =>
    setIndex(Math.round(event.nativeEvent.contentOffset.x / width));

  async function finish() {
    await AsyncStorage.setItem(ONBOARDING_KEY, '1');
    navigation.replace('RoleSelect');
  }

  const last = index === SLIDES.length - 1;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.brand}>
        <Ionicons name="eye" size={28} color={colors.primary} />
        <Text style={styles.brandName}>{APP_NAME}</Text>
      </View>
      <Text style={styles.tagline}>{TAGLINE}</Text>
      <FlatList
        ref={list}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.title}
        onMomentumScrollEnd={onScrollEnd}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]} accessible accessibilityLabel={`${item.title}. ${item.text}`}>
            <View style={styles.illustration}>
              <Ionicons name={item.icon} size={72} color={colors.primary} />
            </View>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.text}>{item.text}</Text>
          </View>
        )}
      />
      <View style={styles.dots} accessibilityLabel={`Page ${index + 1} of ${SLIDES.length}`}>
        {SLIDES.map((slide, i) => (
          <View key={slide.title} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>
      <View style={styles.footer}>
        <Button
          title={last ? 'Get Started' : 'Next'}
          icon={last ? 'arrow-forward' : undefined}
          onPress={() => {
            if (last) return finish();
            list.current?.scrollToIndex({ index: index + 1 });
            setIndex(index + 1);
          }}
        />
        {!last ? <Button title="Skip" variant="ghost" onPress={finish} style={{ marginTop: spacing.sm }} /> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  brand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xl },
  brandName: { fontSize: 24, fontWeight: '800', color: colors.primary },
  tagline: { ...typography.caption, textAlign: 'center', marginTop: spacing.xs },
  slide: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl },
  illustration: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  title: { ...typography.title, textAlign: 'center' },
  text: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.borderStrong },
  dotActive: { width: 22, backgroundColor: colors.primary },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
});
