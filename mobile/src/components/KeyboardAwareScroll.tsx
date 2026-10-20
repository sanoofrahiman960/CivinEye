import type { Ref } from 'react';
import { StyleSheet } from 'react-native';
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewProps } from 'react-native-keyboard-aware-scroll-view';

export type KeyboardAwareScrollRef = KeyboardAwareScrollView;

interface KeyboardAwareScrollProps extends KeyboardAwareScrollViewProps {
  ref?: Ref<KeyboardAwareScrollView>;
}

/**
 * ScrollView that keeps the focused text field above the keyboard on both platforms.
 * Android needs `enableOnAndroid`: with edge-to-edge the window no longer resizes for the keyboard.
 */
export function KeyboardAwareScroll({ ref, children, contentContainerStyle, ...props }: KeyboardAwareScrollProps) {
  // On Android the library adds the keyboard height to `contentContainerStyle.paddingBottom`, reading it
  // without flattening: an array or a `padding` shorthand would lose the screen's own bottom padding.
  const flat = StyleSheet.flatten(contentContainerStyle) ?? {};
  const paddingBottom = flat.paddingBottom ?? flat.paddingVertical ?? flat.padding ?? 0;
  return (
    <KeyboardAwareScrollView
      ref={ref}
      enableOnAndroid
      extraScrollHeight={24}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      // Don't jump back to the old scroll position when the keyboard closes.
      enableResetScrollToCoords={false}
      contentContainerStyle={{ ...flat, paddingBottom }}
      {...props}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
