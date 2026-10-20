import type {
  AppConfiguration,
  AppNotification,
  AuthResponse,
  AuthorityIssueDetail,
  AuthorityIssueImage,
  AuthorityIssueListItem,
  CaptureSource,
  Category,
  Comment,
  CommentVisibility,
  Dashboard,
  Department,
  IssueStatus,
  JurisdictionArea,
  Paginated,
  Priority,
  ReportSummary,
  ServiceArea,
  TeamMember,
  TeamMemberInput,
  User,
} from '../types/api';
import { buildFormData, get, http, patch, post } from './client';

// --- Auth ----------------------------------------------------------------------

export const authApi = {
  /** Staff sign in with the username + password their administrator created. Citizens get `wrong_portal`. */
  login: (username: string, password: string) =>
    post<AuthResponse>('/auth/login/', { username: username.trim().toLowerCase(), password }),
  logout: (refresh: string) => post<void>('/auth/logout/', { refresh }),
  me: () => get<User>('/auth/me/'),
  updateProfile: (changes: Partial<Pick<User, 'username' | 'email' | 'full_name' | 'phone_number'>>) =>
    patch<User>('/auth/profile/', changes),
  changePassword: (current_password: string, new_password: string) =>
    post<AuthResponse>('/auth/change-password/', { current_password, new_password }),
};

// --- Reference data -------------------------------------------------------------------

export const referenceApi = {
  configuration: () => get<AppConfiguration>('/configuration/'),
  categories: () => get<Category[]>('/issue-categories/'),
  departments: () => get<Department[]>('/departments/'),
  serviceAreas: () => get<ServiceArea[]>('/service-areas/'),
  /** Areas inside the signed-in user's jurisdiction, parents before children. */
  jurisdictionAreas: () => get<JurisdictionArea[]>('/authority/areas/'),
};

// --- Authority -------------------------------------------------------------------------

export type AuthoritySort = 'newest' | 'oldest' | 'priority' | 'longest_unresolved';

export interface IssueQuery {
  status?: IssueStatus[];
  priority?: Priority[];
  category?: number;
  department?: number;
  service_area?: number;
  assigned_officer?: number | 'me' | 'unassigned';
  date_from?: string;
  date_to?: string;
  overdue?: boolean;
  search?: string;
  sort?: AuthoritySort;
  page?: number;
  page_size?: number;
}

export interface ResolutionCapture {
  capture_source: CaptureSource;
  capture_latitude?: number | null;
  capture_longitude?: number | null;
  capture_accuracy_m?: number | null;
  captured_at?: string | null;
}

export function toQueryParams({ status, priority, overdue, search, ...rest }: IssueQuery) {
  return {
    ...rest,
    status: status?.length ? status.join(',') : undefined,
    priority: priority?.length ? priority.join(',') : undefined,
    overdue: overdue ? 'true' : undefined,
    search: search || undefined,
  };
}

export const authorityApi = {
  dashboard: (period: 'weekly' | 'monthly' = 'weekly') => get<Dashboard>('/authority/dashboard/', { params: { period } }),
  issues: (query: IssueQuery = {}) =>
    get<Paginated<AuthorityIssueListItem>>('/authority/issues/', { params: toQueryParams(query) }),
  detail: (id: number) => get<AuthorityIssueDetail>(`/authority/issues/${id}/`),
  acknowledge: (id: number, comment = '') => post<AuthorityIssueDetail>(`/authority/issues/${id}/acknowledge/`, { comment }),
  startWork: (id: number, comment = '') => post<AuthorityIssueDetail>(`/authority/issues/${id}/start-work/`, { comment }),
  /** Rejects with ApiError `proof_check_flagged` (409) or `camera_required` (400) under Proof-Lock. */
  resolve: (id: number, resolution_description: string, files: File[], capture: ResolutionCapture) =>
    post<AuthorityIssueDetail>(`/authority/issues/${id}/resolve/`, buildFormData({ resolution_description, ...capture }, files), {
      timeout: 120000,
    }),
  reopen: (id: number, reason: string) => post<AuthorityIssueDetail>(`/authority/issues/${id}/reopen/`, { reason }),
  close: (id: number, reason: string) => post<AuthorityIssueDetail>(`/authority/issues/${id}/close/`, { reason }),
  changePriority: (id: number, priority: Priority, reason: string) =>
    patch<AuthorityIssueDetail>(`/authority/issues/${id}/priority/`, { priority, reason }),
  assign: (id: number, department_id: number, officer_id: number | null, notes = '') =>
    post<AuthorityIssueDetail>(`/authority/issues/${id}/assign/`, { department_id, officer_id, notes }),
  comment: (id: number, comment: string, visibility: CommentVisibility) =>
    post<Comment>(`/authority/issues/${id}/comments/`, { comment, visibility }),
  overrideProofCheck: (imageId: number, reason: string) =>
    post<AuthorityIssueImage>(`/authority/images/${imageId}/override-proof-check/`, { reason }),
  /** With `issue`, only officers whose service areas cover that issue's location. */
  officers: (department?: number, issue?: number) => get<User[]>('/authority/officers/', { params: { department, issue } }),
  reportSummary: (query: IssueQuery = {}) => get<ReportSummary>('/authority/reports/', { params: toQueryParams(query) }),
  /** CSV of the filtered issues as a Blob, ready to download. */
  exportCsv: async (query: IssueQuery = {}) => {
    const response = await http.get<Blob>('/authority/reports/', {
      params: { ...toQueryParams(query), export: 'csv' },
      responseType: 'blob',
      timeout: 120000,
    });
    return response.data;
  },
};

// --- Team (hierarchical administration) -------------------------------------------------

export interface TeamQuery {
  role?: TeamMember['role'];
  area?: number;
  department?: number;
  active?: boolean;
  search?: string;
  page?: number;
}

export const teamApi = {
  list: ({ active, ...query }: TeamQuery = {}) =>
    get<Paginated<TeamMember>>('/authority/team/', {
      params: { ...query, active: active === undefined ? undefined : String(active), search: query.search || undefined },
    }),
  create: (input: TeamMemberInput) => post<TeamMember>('/authority/team/', input),
  update: (id: number, changes: Partial<TeamMemberInput>) => patch<TeamMember>(`/authority/team/${id}/`, changes),
  resetPassword: (id: number, new_password: string) =>
    post<{ detail: string }>(`/authority/team/${id}/reset-password/`, { new_password }),
};

// --- Notifications ------------------------------------------------------------------------

export const notificationApi = {
  list: (page = 1, unreadOnly = false) =>
    get<Paginated<AppNotification>>('/notifications/', { params: { page, unread: unreadOnly ? 'true' : undefined } }),
  unreadCount: () => get<{ unread: number }>('/notifications/unread-count/'),
  markRead: (id: number) => patch<AppNotification>(`/notifications/${id}/read/`),
  markAllRead: () => post<{ updated: number }>('/notifications/read-all/'),
};
