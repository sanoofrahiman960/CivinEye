import type { AppConfiguration, Category, Department, EmergencyContact } from '../types/api';
import { get } from './client';

export const referenceApi = {
  configuration: () => get<AppConfiguration>('/configuration/'),
  categories: () => get<Category[]>('/issue-categories/'),
  departments: () => get<Department[]>('/departments/'),
  emergencyContacts: (params: { lat?: number; lng?: number; category?: number }) =>
    get<EmergencyContact[]>('/emergency-contacts/', { params }),
};
