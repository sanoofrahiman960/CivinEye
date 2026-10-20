import { render, screen } from '@testing-library/react-native';
import { Platform, Text } from 'react-native';

import { KeyboardAwareScroll } from '../components/KeyboardAwareScroll';

describe('KeyboardAwareScroll', () => {
  it('keeps the screen’s own bottom padding when the style is an array or shorthand', () => {
    render(
      <KeyboardAwareScroll testID="scroll" contentContainerStyle={[{ padding: 16 }, { gap: 8 }]}>
        <Text>Form</Text>
      </KeyboardAwareScroll>,
    );
    const style = [screen.getByTestId('scroll').props.contentContainerStyle].flat(3);
    const merged = Object.assign({}, ...style);
    expect(merged.paddingBottom).toBe(16);
    expect(merged.gap).toBe(8);
    expect(screen.getByText('Form')).toBeTruthy();
  });

  it('turns keyboard handling on for Android', () => {
    Platform.OS = 'android';
    render(<KeyboardAwareScroll testID="scroll" contentContainerStyle={{ paddingBottom: 40 }} />);
    const style = [screen.getByTestId('scroll').props.contentContainerStyle].flat(3);
    expect(Object.assign({}, ...style).paddingBottom).toBe(40);
  });
});
