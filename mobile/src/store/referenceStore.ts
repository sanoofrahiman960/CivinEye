import { create } from 'zustand';

import { referenceApi } from '../api/referenceApi';
import type { AppConfiguration, Category, Department, FeatureKey } from '../types/api';

interface ReferenceState {
  config: AppConfiguration | null;
  categories: Category[];
  departments: Department[];
  loaded: boolean;
  load: (force?: boolean) => Promise<void>;
  isEnabled: (feature: FeatureKey) => boolean;
  featureConfig: (feature: FeatureKey, key: string, fallback: number) => number;
}

/** Configuration, categories and departments, loaded once per session. */
export const useReferenceStore = create<ReferenceState>((set, get) => ({
  config: null,
  categories: [],
  departments: [],
  loaded: false,

  load: async (force = false) => {
    if (get().loaded && !force) return;
    const [config, categories, departments] = await Promise.all([
      referenceApi.configuration(),
      referenceApi.categories(),
      referenceApi.departments(),
    ]);
    set({ config, categories, departments, loaded: true });
  },

  isEnabled: (feature) => get().config?.features[feature]?.enabled ?? false,

  featureConfig: (feature, key, fallback) => get().config?.features[feature]?.config?.[key] ?? fallback,
}));
