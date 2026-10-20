import type {
  CitizenIssueView,
  Comment,
  DurabilityAnswerResult,
  DurabilityCheck,
  HistoryEntry,
  IssueDetail,
  IssueImage,
  IssueListItem,
  IssueStatus,
  IssueSummary,
  MapIssue,
  NearbyIssue,
  Paginated,
  Priority,
} from '../types/api';
import { buildFormData, del, get, post, postMultipart, type UploadablePhoto } from './client';

export interface NewIssueInput {
  title: string;
  description: string;
  category: number;
  subcategory?: number | null;
  latitude: number;
  longitude: number;
  location_accuracy_m?: number | null;
  address?: string;
  additional_details?: string;
  reported_urgency?: Priority | '';
  /** Idempotency key: re-sending the same id returns the original complaint instead of a duplicate. */
  client_submission_id: string;
  /** When the report was captured, for reports sent later from the offline queue. */
  client_reported_at?: string;
}

export type MyIssuesSort = 'newest' | 'oldest' | 'priority' | 'updated';

export interface MyIssuesQuery {
  status?: IssueStatus[];
  search?: string;
  sort?: MyIssuesSort;
  page?: number;
}

export interface MapQuery {
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
  category?: number;
  status?: IssueStatus[];
  priority?: Priority[];
}

const list = (values?: string[]) => (values && values.length ? values.join(',') : undefined);

export const issueApi = {
  create: (input: NewIssueInput, photos: UploadablePhoto[]) =>
    postMultipart<IssueDetail>('/issues/', buildFormData({ ...input }, photos)),

  myIssues: ({ status, search, sort, page }: MyIssuesQuery = {}) =>
    get<Paginated<IssueListItem>>('/issues/my/', { params: { status: list(status), search: search || undefined, sort, page } }),

  summary: () => get<IssueSummary>('/issues/my/summary/'),

  detail: (id: number) => get<CitizenIssueView>(`/issues/${id}/`),

  history: (id: number) => get<HistoryEntry[]>(`/issues/${id}/history/`),

  comments: (id: number) => get<Comment[]>(`/issues/${id}/comments/`),

  addComment: (id: number, comment: string) => post<Comment>(`/issues/${id}/comments/`, { comment }),

  addEvidence: (id: number, photos: UploadablePhoto[], caption = '') =>
    postMultipart<IssueImage[]>(`/issues/${id}/additional-evidence/`, buildFormData({ caption }, photos)),

  reopen: (id: number, reason: string, photos: UploadablePhoto[] = []) =>
    postMultipart<IssueDetail>(`/issues/${id}/reopen/`, buildFormData({ reason }, photos)),

  confirmResolution: (id: number, rating?: number | null, comment?: string) =>
    post<IssueDetail>(`/issues/${id}/confirm-resolution/`, { rating: rating ?? null, comment: comment ?? '' }),

  nearby: (lat: number, lng: number, category?: number, radius_m?: number) =>
    get<NearbyIssue[]>('/issues/nearby/', { params: { lat, lng, category, radius_m } }),

  map: ({ status, priority, ...box }: MapQuery) =>
    get<MapIssue[]>('/issues/map/', { params: { ...box, status: list(status), priority: list(priority) } }),

  support: (id: number, latitude: number, longitude: number, note = '') =>
    post<CitizenIssueView>(`/issues/${id}/support/`, { latitude, longitude, note }),

  removeSupport: (id: number) => del<CitizenIssueView>(`/issues/${id}/support/`),

  durabilityChecks: () => get<DurabilityCheck[]>('/durability-checks/'),

  answerDurability: (id: number, response: 'STILL_FIXED' | 'PROBLEM_RETURNED', note = '', photos: UploadablePhoto[] = []) =>
    postMultipart<DurabilityAnswerResult>(`/issues/${id}/durability-response/`, buildFormData({ response, note }, photos)),
};
