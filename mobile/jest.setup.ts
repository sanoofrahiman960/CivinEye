/* Global mocks for native modules that have no JavaScript implementation under Jest. */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __reset: () => store.clear(),
  };
});

/** In-memory stand-in for the expo-file-system File / Directory / Paths API. */
jest.mock('expo-file-system', () => {
  const files = new Set<string>();
  const join = (...parts: unknown[]) =>
    parts
      .map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri))
      .join('/')
      .replace(/(?<!:)\/{2,}/g, '/');
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(...parts);
    }
    get exists() {
      return true;
    }
    create() {}
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(...parts);
    }
    get exists() {
      return files.has(this.uri);
    }
    delete() {
      files.delete(this.uri);
    }
    create() {
      files.add(this.uri);
    }
    write() {
      files.add(this.uri);
    }
    async copy(target: File) {
      files.add(target.uri);
    }
  }
  return {
    File,
    Directory,
    Paths: { document: new Directory('file:///document'), cache: new Directory('file:///cache') },
    __files: files,
  };
});

/** Icon fonts are native assets; render a plain placeholder in tests. */
jest.mock('@expo/vector-icons/Ionicons', () => {
  const { createElement } = require('react');
  const { View } = require('react-native');
  const Icon = ({ name }: { name: string }) => createElement(View, { testID: `icon-${name}` });
  Icon.glyphMap = {};
  return { __esModule: true, default: Icon };
});
