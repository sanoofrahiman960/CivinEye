import { create } from 'zustand';

import { referenceApi } from '../api/endpoints';
import type { AppConfiguration, Category, Department, FeatureKey, JurisdictionArea } from '../types/api';

interface ReferenceState {
  config: AppConfiguration | null;
  categories: Category[];
  departments: Department[];
  /** Areas inside the signed-in user's jurisdiction, in tree order. */
  serviceAreas: JurisdictionArea[];
  loaded: boolean;
  load: () => Promise<void>;
  isEnabled: (feature: FeatureKey) => boolean;
  featureConfig: (feature: FeatureKey, key: string, fallback: number) => number;
}

let inflight: Promise<void> | null = null;

export const useReferenceStore = create<ReferenceState>((set, get) => ({
  config: null,
  categories: [],
  departments: [],
  serviceAreas: [],
  loaded: false,

  load: () => {
    if (get().loaded) return Promise.resolve();
    inflight =
      inflight ??
      Promise.all([referenceApi.configuration(), referenceApi.categories(), referenceApi.departments(), referenceApi.jurisdictionAreas()])
        .then(([config, categories, departments, serviceAreas]) => set({ config, categories, departments, serviceAreas, loaded: true }))
        .finally(() => {
          inflight = null;
        });
    return inflight;
  },

  isEnabled: (feature) => get().config?.features[feature]?.enabled ?? false,
  featureConfig: (feature, key, fallback) => get().config?.features[feature]?.config?.[key] ?? fallback,
}));
