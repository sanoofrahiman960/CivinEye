import type {
  AuthorityIssueDetail,
  AuthorityIssueImage,
  AuthorityIssueListItem,
  CaptureSource,
  Comment,
  CommentVisibility,
  Dashboard,
  IssueStatus,
  Paginated,
  Priority,
  ReportSummary,
  User,
} from '../types/api';
import { buildFormData, get, http, patch, post, postMultipart, type UploadablePhoto } from './client';

export type AuthoritySort = 'newest' | 'oldest' | 'priority' | 'longest_unresolved';

export interface AuthorityIssueQuery {
  status?: IssueStatus[];
  priority?: Priority[];
  category?: number;
  department?: number;
  service_area?: number;
  /** Officer id, or 'me' / 'unassigned'. */
  assigned_officer?: number | 'me' | 'unassigned';
  date_from?: string;
  date_to?: string;
  overdue?: boolean;
  search?: string;
  sort?: AuthoritySort;
  page?: number;
}

export interface ResolutionCapture {
  capture_source: CaptureSource;
  capture_latitude?: number | null;
  capture_longitude?: number | null;
  capture_accuracy_m?: number | null;
  captured_at?: string | null;
}

function toParams({ status, priority, overdue, search, ...rest }: AuthorityIssueQuery) {
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

  issues: (query: AuthorityIssueQuery = {}) =>
    get<Paginated<AuthorityIssueListItem>>('/authority/issues/', { params: toParams(query) }),

  detail: (id: number) => get<AuthorityIssueDetail>(`/authority/issues/${id}/`),

  acknowledge: (id: number, comment = '') => post<AuthorityIssueDetail>(`/authority/issues/${id}/acknowledge/`, { comment }),

  startWork: (id: number, comment = '') => post<AuthorityIssueDetail>(`/authority/issues/${id}/start-work/`, { comment }),

  /** Rejects with ApiError code `proof_check_flagged` (409) when Proof-Lock flags the photos. */
  resolve: (id: number, resolution_description: string, photos: UploadablePhoto[], capture: ResolutionCapture) =>
    postMultipart<AuthorityIssueDetail>(
      `/authority/issues/${id}/resolve/`,
      buildFormData({ resolution_description, ...capture }, photos),
    ),

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

  /** Officers of a department; with `issue`, only those whose service areas cover that issue's location. */
  officers: (department?: number, issue?: number) => get<User[]>('/authority/officers/', { params: { department, issue } }),

  reportSummary: (query: AuthorityIssueQuery = {}) => get<ReportSummary>('/authority/reports/', { params: toParams(query) }),

  /** CSV text of the filtered issues. */
  exportCsv: async (query: AuthorityIssueQuery = {}) => {
    const response = await http.get<string>('/authority/reports/', {
      params: { ...toParams(query), export: 'csv' },
      responseType: 'text',
      transformResponse: (data) => data,
    });
    return response.data;
  },
};
