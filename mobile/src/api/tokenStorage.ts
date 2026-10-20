import * as SecureStore from 'expo-secure-store';

import type { TokenPair } from '../types/api';

const ACCESS_KEY = 'civiceye.access';
const REFRESH_KEY = 'civiceye.refresh';

/** Tokens live in the device keychain/keystore (never AsyncStorage), with an in-memory copy for requests. */
let memory: TokenPair | null = null;

export const tokenStorage = {
  async load(): Promise<TokenPair | null> {
    const [access, refresh] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
    ]);
    memory = access && refresh ? { access, refresh } : null;
    return memory;
  },

  async save(tokens: TokenPair): Promise<void> {
    memory = tokens;
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, tokens.access),
      SecureStore.setItemAsync(REFRESH_KEY, tokens.refresh),
    ]);
  },

  async clear(): Promise<void> {
    memory = null;
    await Promise.all([SecureStore.deleteItemAsync(ACCESS_KEY), SecureStore.deleteItemAsync(REFRESH_KEY)]);
  },

  get access(): string | null {
    return memory?.access ?? null;
  },

  get refresh(): string | null {
    return memory?.refresh ?? null;
  },
};
