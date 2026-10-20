import { formatDistance, formatDue, formatHours, formatRelative } from '../utils/format';
import { hasErrors, normalisePhone, validateEmail, validatePassword, validatePhone } from '../utils/validation';

describe('format helpers', () => {
  const now = new Date('2026-10-20T12:00:00Z');

  it('formats relative times', () => {
    expect(formatRelative('2026-10-20T11:59:30Z', now)).toBe('just now');
    expect(formatRelative('2026-10-20T11:45:00Z', now)).toBe('15 min ago');
    expect(formatRelative('2026-10-20T09:00:00Z', now)).toBe('3 h ago');
    expect(formatRelative('2026-10-18T12:00:00Z', now)).toBe('2 days ago');
    expect(formatRelative(null, now)).toBe('—');
  });

  it('formats SLA due dates in both directions', () => {
    expect(formatDue('2026-10-20T17:00:00Z', now)).toBe('Due in 5 h');
    expect(formatDue('2026-10-18T12:00:00Z', now)).toBe('Overdue by 2 days');
    expect(formatDue(null, now)).toBe('No deadline');
  });

  it('formats durations and distances', () => {
    expect(formatHours(0.5)).toBe('30 min');
    expect(formatHours(12.25)).toBe('12.3 h');
    expect(formatHours(72)).toBe('3.0 days');
    expect(formatHours(null)).toBe('—');
    expect(formatDistance(12.4)).toBe('12 m');
    expect(formatDistance(2400)).toBe('2.4 km');
  });
});

describe('validation helpers', () => {
  it('validates email', () => {
    expect(validateEmail('')).toBe('Enter your email address.');
    expect(validateEmail('not-an-email')).toBe('Enter a valid email address.');
    expect(validateEmail('a@b.co')).toBeUndefined();
  });

  it('validates phone numbers like the backend (7–15 digits, optional +)', () => {
    expect(validatePhone('+91 98123-45678')).toBeUndefined();
    expect(validatePhone('12ab')).toBeDefined();
    expect(normalisePhone('+91 98123-45678')).toBe('+919812345678');
  });

  it('validates passwords', () => {
    expect(validatePassword('short')).toBe('Use at least 8 characters.');
    expect(validatePassword('12345678')).toBe('The password cannot be only numbers.');
    expect(validatePassword('Kochi-Rains-2026')).toBeUndefined();
  });

  it('detects errors', () => {
    expect(hasErrors({ a: undefined, b: undefined })).toBe(false);
    expect(hasErrors({ a: undefined, b: 'bad' })).toBe(true);
  });
});
