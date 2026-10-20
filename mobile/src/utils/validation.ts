const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9]{7,15}$/;

export type Errors<T extends string> = Partial<Record<T, string>>;

export function validateEmail(value: string): string | undefined {
  if (!value.trim()) return 'Enter your email address.';
  if (!EMAIL.test(value.trim())) return 'Enter a valid email address.';
  return undefined;
}

/** Staff login names: same rule as the backend (3–50 lowercase letters, digits, dots, hyphens, underscores). */
export function validateUsername(value: string): string | undefined {
  const cleaned = value.trim().toLowerCase();
  if (!cleaned) return 'Enter a username.';
  if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(cleaned)) return 'Use 3–50 lowercase letters, digits, dots, hyphens or underscores.';
  return undefined;
}

export function validatePhone(value: string): string | undefined {
  const cleaned = value.replace(/[\s-]/g, '');
  if (!cleaned) return 'Enter your phone number.';
  if (!PHONE.test(cleaned)) return 'Enter a valid phone number (7–15 digits, optional +).';
  return undefined;
}

export function validatePassword(value: string): string | undefined {
  if (!value) return 'Enter a password.';
  if (value.length < 8) return 'Use at least 8 characters.';
  if (/^\d+$/.test(value)) return 'The password cannot be only numbers.';
  return undefined;
}

export function required(value: string, message: string): string | undefined {
  return value.trim() ? undefined : message;
}

export function minLength(value: string, length: number, message: string): string | undefined {
  return value.trim().length >= length ? undefined : message;
}

export function hasErrors<T extends string>(errors: Errors<T>): boolean {
  return Object.values(errors).some(Boolean);
}

export function normalisePhone(value: string): string {
  return value.replace(/[\s-]/g, '');
}
